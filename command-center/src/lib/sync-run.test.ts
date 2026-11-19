import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Patch = { finished_at: string; ok: boolean; detail: string }
const inserted: object[] = []
const patches: Patch[] = []
/** Answers for successive update calls: undefined = success. */
let updateErrors: ({ message: string; code?: string; status?: number } | undefined)[] = []

vi.mock('./supabase', () => ({
  supabase: () => ({
    from: () => ({
      insert: (row: object) => { inserted.push(row); return { select: () => ({ single: async () => ({ data: { id: 7 }, error: null, status: 201 }) }) } },
      update: (patch: Patch) => ({
        eq: async () => {
          const e = updateErrors.shift()
          if (e) return { error: { message: e.message, code: e.code }, status: e.status }
          patches.push(patch)
          return { error: null, status: 200 }
        },
      }),
    }),
  }),
}))

const { withRun } = await import('./sync-run')

beforeEach(() => { inserted.length = 0; patches.length = 0; updateErrors = [] })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('withRun', () => {
  it('records ok:true with the result as detail by default', async () => {
    await expect(withRun('meta', 'kaiven', async () => ({ n: 1 }))).resolves.toEqual({ n: 1 })
    expect(inserted[0]).toMatchObject({ source: 'meta', store_id: 'kaiven' })
    expect(patches[0].ok).toBe(true)
    expect(JSON.parse(patches[0].detail)).toEqual({ n: 1 })
  })

  it('records ok:false with the FULL result when isOk says so, and still returns it', async () => {
    const r = { ok: false, skipped: ['Kaiven: no access'], accounts: [{ status: 'no_access' }] }
    await expect(withRun('meta', 'kaiven', async () => r, (x) => x.ok)).resolves.toEqual(r)
    expect(patches[0].ok).toBe(false)
    expect(JSON.parse(patches[0].detail)).toEqual(r)
  })

  it('records a thrown error as ok:false and rethrows the original', async () => {
    const boom = new Error('boom')
    await expect(withRun('meta', 'kaiven', async () => { throw boom })).rejects.toBe(boom)
    expect(patches[0].ok).toBe(false)
    expect(JSON.parse(patches[0].detail)).toEqual({ error: 'boom' })
  })

  it('logs a failed failure-write and still rethrows the ORIGINAL error', async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    updateErrors = [1, 2, 3].map(() => ({ message: 'connection reset', status: 503 }))
    const boom = new Error('the real failure')
    const p = withRun('meta', 'kaiven', async () => { throw boom }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await p).toBe(boom)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('could not record the failure'))
  })

  it('retries a transient finish-write twice, then succeeds', async () => {
    vi.useFakeTimers()
    updateErrors = [{ message: 'timeout', code: '57014', status: 500 }, { message: 'timeout', code: '57014', status: 500 }]
    const p = withRun('meta', 'kaiven', async () => ({ n: 1 }))
    await vi.advanceTimersByTimeAsync(5000)
    await expect(p).resolves.toEqual({ n: 1 })
    expect(patches).toHaveLength(1)
  })

  it('throws the finish-write error after 3 transient failures (stale freshness must not look fresh)', async () => {
    vi.useFakeTimers()
    updateErrors = [1, 2, 3].map(() => ({ message: 'timeout', code: '57014', status: 500 }))
    const p = withRun('meta', 'kaiven', async () => ({ n: 1 })).catch((e) => e)
    await vi.advanceTimersByTimeAsync(5000)
    expect(((await p) as Error).message).toMatch(/cc_sync_runs 7: timeout/)
  })

  it('does not retry a permanent finish-write error', async () => {
    updateErrors = [{ message: 'bad column', code: '42703', status: 400 }, undefined]
    await expect(withRun('meta', 'kaiven', async () => ({ n: 1 }))).rejects.toThrow(/bad column/)
    expect(patches).toHaveLength(0)
  })
})
