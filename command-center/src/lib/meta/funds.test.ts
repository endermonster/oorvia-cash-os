import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Row = Record<string, unknown>
const h = vi.hoisted(() => ({
  stored: [] as Record<string, unknown>[],
  upserts: [] as Record<string, unknown>[],
  runs: [] as boolean[],
  pushes: [] as string[],
  pushFails: false,
  /** account id -> account fields, or an Error to throw */
  info: {} as Record<string, unknown>,
  days: {} as Record<string, { spend: string; date_start: string }[]>,
  active: {} as Record<string, { id: string }[]>,
  calls: [] as { path: string; params: Record<string, string | number> }[],
}))

vi.mock('../supabase', () => ({
  supabase: () => ({
    from: () => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.order = () => q
      q.range = async (from: number, to: number) => ({ data: h.stored.slice(from, to + 1), error: null, status: 200 })
      q.upsert = async (row: Row) => { h.upserts.push(row); return { error: null, status: 200 } }
      return q
    },
  }),
}))
vi.mock('../sync-run', () => ({
  withRun: async (_s: string, _store: null, fn: () => Promise<object>, isOk: (r: object) => boolean) => {
    const r = await fn()
    h.runs.push(isOk(r))
    return r
  },
}))
vi.mock('../ntfy', () => ({
  notify: async ({ title }: { title: string }) => {
    if (h.pushFails) throw new Error('ntfy 503')
    h.pushes.push(title)
  },
}))
vi.mock('./client', async (orig) => ({
  ...(await orig<typeof import('./client')>()),
  graphGet: async (path: string) => {
    const v = h.info[path.replace('act_', '')]
    if (v instanceof Error) throw v
    return v
  },
  graphGetAll: async (path: string, params: Record<string, string | number>) => {
    h.calls.push({ path, params })
    const id = /act_(\d+)/.exec(path)![1]
    return path.endsWith('/insights') ? (h.days[id] ?? []) : (h.active[id] ?? [])
  },
}))

const { checkFunds } = await import('./funds')
const { AD_ACCOUNTS } = await import('./accounts')
const { MetaError } = await import('./client')

const OORVIA_1 = '1338726490985485'
const TODAY = '2026-11-24'
const noAccess = () => new MetaError('no access', false, 'no_access')
const info = (spent: number, cap = 1_000_000) => ({ currency: 'INR', account_status: 1, is_prepay_account: true, spend_cap: String(cap), amount_spent: String(spent) })
const upsertOf = (id: string) => h.upserts.find((r) => r.account_id === id)!

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-24T08:00:00Z')) // 13:30 IST
  Object.assign(h, { stored: [], upserts: [], runs: [], pushes: [], pushFails: false, info: {}, days: {}, active: {}, calls: [] })
  for (const a of AD_ACCOUNTS) h.info[a.id] = noAccess()
})
afterEach(() => { vi.useRealTimers() })

describe('checkFunds', () => {
  it('reads one insights call by day: 7 complete days for the average, today as its own spend', async () => {
    h.info[OORVIA_1] = info(400_000)
    h.days[OORVIA_1] = [{ spend: '700', date_start: '2026-11-17' }, { spend: '700', date_start: '2026-11-23' }, { spend: '250', date_start: TODAY }]
    await checkFunds()
    const insights = h.calls.find((c) => c.path.endsWith('/insights'))!
    expect(insights.params).toMatchObject({ time_increment: 1, time_range: JSON.stringify({ since: '2026-11-17', until: TODAY }) })
    expect(upsertOf(OORVIA_1)).toMatchObject({ daily_spend_paise: 20_000, today_spend_paise: 25_000 })
  })

  it('fails the run when no account could be read', async () => {
    const r = await checkFunds()
    expect(r.ok).toBe(false)
    expect(h.runs).toEqual([false])
  })

  it('saves the read but fails the run when a push did not go out, and keeps that push pending', async () => {
    h.info[OORVIA_1] = info(1_000_000) // ₹0 left
    h.days[OORVIA_1] = [{ spend: '500', date_start: TODAY }]
    h.active[OORVIA_1] = [{ id: 'c1' }]
    h.pushFails = true
    const r = await checkFunds()
    expect(r.ok).toBe(false)
    expect(h.runs).toEqual([false])
    expect(upsertOf(OORVIA_1)).toMatchObject({ alert_level: 'ok', pending_push: 'out', amount_spent_paise: 1_000_000 })
  })

  it('sends a pending "funds OK" on the next run although the balance no longer moved', async () => {
    h.stored = [{
      account_id: OORVIA_1, store_id: 'oorvia', name: 'Oorvia-1', account_status: 1, spend_cap_paise: 2_000_000, amount_spent_paise: 1_000_000,
      daily_spend_paise: 0, today_spend_paise: 0, active_campaigns: false, checked_at: '2026-11-24T06:00:00Z', alert_level: 'out', pending_push: 'ok',
    }]
    h.info[OORVIA_1] = info(1_000_000, 2_000_000) // same ₹10,000 left as the stored read
    const r = await checkFunds()
    expect(h.pushes).toEqual(['Oorvia-1 funds OK'])
    expect(upsertOf(OORVIA_1)).toMatchObject({ alert_level: 'ok', pending_push: null })
    expect(r.ok).toBe(true)
  })

  it('leaves the push pending rather than start it past the Meta deadline', async () => {
    h.info[OORVIA_1] = info(1_000_000)
    h.days[OORVIA_1] = [{ spend: '500', date_start: TODAY }]
    h.active[OORVIA_1] = [{ id: 'c1' }]
    const r = await checkFunds({ call: { deadlineAt: Date.now() - 1 } })
    expect(h.pushes).toEqual([])
    expect(upsertOf(OORVIA_1)).toMatchObject({ alert_level: 'ok', pending_push: 'out' })
    expect(r.ok).toBe(false)
  })

  it('pushes out for an account that spent only today (resumed after a quiet week)', async () => {
    h.info[OORVIA_1] = info(1_000_000)
    h.days[OORVIA_1] = [{ spend: '500', date_start: TODAY }]
    h.active[OORVIA_1] = [{ id: 'c1' }]
    await checkFunds()
    expect(h.pushes).toEqual(['Oorvia-1 out of funds'])
    expect(upsertOf(OORVIA_1)).toMatchObject({ alert_level: 'out', pending_push: null })
  })
})
