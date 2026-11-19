import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Row = { source: string; store_id: string; holder: string; acquired_at: string; expires_at: string }
const h = vi.hoisted(() => ({ rows: [] as Row[], failInsert: null as null | { message: string; code: string } }))

/** cc_sync_locks in memory, with its primary key (source, store_id). */
vi.mock('./supabase', () => ({
  supabase: () => ({
    from: () => {
      const where: ((r: Row) => boolean)[] = []
      const chain = <T extends object>(q: T, done: () => unknown) => Object.assign(q, {
        eq: (c: keyof Row, v: string) => { where.push((r) => r[c] === v); return q },
        lt: (c: keyof Row, v: string) => { where.push((r) => r[c] < v); return q },
        then: (resolve: (v: unknown) => void) => resolve(done()),
      })
      const match = (r: Row) => where.every((f) => f(r))
      return {
        insert: async (row: Row) => {
          if (h.failInsert) return { error: h.failInsert, status: 500 }
          if (h.rows.some((r) => r.source === row.source && r.store_id === row.store_id)) {
            return { error: { message: 'duplicate key value violates unique constraint', code: '23505' }, status: 409 }
          }
          h.rows.push({ ...row })
          return { error: null, status: 201 }
        },
        delete: () => chain({}, () => { h.rows = h.rows.filter((r) => !match(r)); return { error: null, status: 204 } }),
        select: () => {
          const q = chain({} as Record<string, unknown>, () => ({ data: h.rows.filter(match), error: null }))
          q.maybeSingle = async () => ({ data: h.rows.find(match) ?? null, error: null })
          return q
        },
        update: (patch: Partial<Row>) => {
          const q = chain({} as Record<string, unknown>, () => null)
          q.select = async () => {
            const hit = h.rows.filter(match)
            for (const r of hit) Object.assign(r, patch)
            return { data: hit.map((r) => ({ holder: r.holder })), error: null, status: 200 }
          }
          return q
        },
      }
    },
  }),
}))

const { withLock, SyncBusyError } = await import('./sync-lock')

beforeEach(() => {
  h.rows = []
  h.failInsert = null
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T06:00:00Z')) // 11:30 IST
})
afterEach(() => { vi.useRealTimers() })

describe('withLock', () => {
  it('holds the lock while fn runs and releases it after', async () => {
    const r = await withLock('meta', 'oorvia', 60_000, async () => {
      expect(h.rows).toHaveLength(1)
      expect(h.rows[0]).toMatchObject({ source: 'meta', store_id: 'oorvia', acquired_at: '2026-11-19T06:00:00.000Z', expires_at: '2026-11-19T06:01:00.000Z' })
      return 42
    })
    expect(r).toBe(42)
    expect(h.rows).toEqual([])
  })

  it('turns away a second sync of the same store without running it, and says when the lock frees', async () => {
    const second = vi.fn()
    let rejected: unknown
    await withLock('meta', 'oorvia', 120_000, async () => {
      rejected = await withLock('meta', 'oorvia', 120_000, second).catch((e) => e)
    })
    expect(second).not.toHaveBeenCalled()
    expect(rejected).toBeInstanceOf(SyncBusyError)
    expect((rejected as Error).message).toBe('A meta sync for oorvia is already running (started 11:30; if that run died, the lock frees at 11:32): try again when it finishes')
    expect(h.rows).toEqual([]) // the turned-away run did not free the first one's lock
  })

  it('lets two stores, or two sources, sync at once', async () => {
    const seen: string[] = []
    await Promise.all([
      withLock('meta', 'oorvia', 60_000, async () => { seen.push('meta/oorvia') }),
      withLock('meta', 'kaiven', 60_000, async () => { seen.push('meta/kaiven') }),
      withLock('shopify', 'oorvia', 60_000, async () => { seen.push('shopify/oorvia') }),
    ])
    expect(seen.sort()).toEqual(['meta/kaiven', 'meta/oorvia', 'shopify/oorvia'])
  })

  it('takes over a lock left by a run that died, once it has expired', async () => {
    h.rows = [{ source: 'meta', store_id: 'oorvia', holder: 'dead', acquired_at: '2026-11-19T05:00:00.000Z', expires_at: '2026-11-19T05:59:59.000Z' }]
    const fn = vi.fn(async () => 'ran')
    await expect(withLock('meta', 'oorvia', 60_000, fn)).resolves.toBe('ran')
    expect(fn).toHaveBeenCalledOnce()
  })

  it('does not take over a lock that has not expired', async () => {
    h.rows = [{ source: 'meta', store_id: 'oorvia', holder: 'alive', acquired_at: '2026-11-19T05:59:00.000Z', expires_at: '2026-11-19T06:00:30.000Z' }]
    await expect(withLock('meta', 'oorvia', 60_000, vi.fn())).rejects.toBeInstanceOf(SyncBusyError)
    expect(h.rows[0].holder).toBe('alive')
  })

  it('renew extends the lock; after a takeover it throws, and the new holder keeps its lock', async () => {
    await expect(withLock('meta', 'oorvia', 60_000, async (lock) => {
      vi.setSystemTime(new Date('2026-11-19T06:00:40Z'))
      await lock.renew()
      expect(h.rows[0].expires_at).toBe('2026-11-19T06:01:40.000Z')
      h.rows[0].holder = 'someone-else' // ours expired and another run took over
      await lock.renew()
    })).rejects.toThrow(/lock for oorvia was lost .*stopped before writing/)
    expect(h.rows).toEqual([expect.objectContaining({ holder: 'someone-else' })])
  })

  it('releases the lock when fn throws', async () => {
    await expect(withLock('meta', 'oorvia', 60_000, async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(h.rows).toEqual([])
  })

  it('reports a database failure as an error, not as busy', async () => {
    h.failInsert = { message: 'connection reset', code: 'PGRST000' }
    const e = (await withLock('meta', 'oorvia', 60_000, vi.fn()).catch((x) => x)) as Error
    expect(e).not.toBeInstanceOf(SyncBusyError)
    expect(e.message).toMatch(/cc_sync_locks: connection reset/)
  })
})
