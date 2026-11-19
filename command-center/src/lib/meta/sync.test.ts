import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Row = Record<string, unknown>
type Op = { table: string; op: 'upsert' | 'delete'; rows?: Row[]; filters?: Record<string, unknown> }
const h = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  ops: [] as unknown[],
  runs: [] as string[],
  lockLost: false,
  graph: {
    info: {} as Record<string, unknown>, // account id -> info object, or an Error to throw
    campaigns: {} as Record<string, unknown[]>,
    ads: {} as Record<string, unknown[]>,
    days: {} as Record<string, unknown[]>,
    /** Hourly rows; when unset, derived from `days` (so they add up). */
    hours: {} as Record<string, unknown[]>,
    /** level=account daily totals; when unset, derived from `days` (so they match). */
    accountDays: {} as Record<string, unknown[]>,
    calls: [] as { path: string; params: Record<string, string | number> }[],
  },
}))

/** A column of a row; `cc_campaigns.ad_account_id` follows the row's campaign_id into cc_campaigns, like the `!inner` join. */
function valueOf(table: string, row: Row, col: string): unknown {
  if (!col.includes('.')) return row[col]
  const [joined, c] = col.split('.')
  if (joined !== 'cc_campaigns' || table === 'cc_campaigns') throw new Error(`fake: unsupported join ${col} on ${table}`)
  return h.tables.cc_campaigns.find((x) => x.campaign_id === row.campaign_id)?.[c]
}

vi.mock('../supabase', () => ({
  supabase: () => ({
    from: (table: string) => {
      const where: ((r: Row) => boolean)[] = []
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.order = () => q
      q.eq = (c: string, v: unknown) => { where.push((r) => valueOf(table, r, c) === v); return q }
      q.gte = (c: string, v: string) => { where.push((r) => String(valueOf(table, r, c)) >= v); return q }
      q.lte = (c: string, v: string) => { where.push((r) => String(valueOf(table, r, c)) <= v); return q }
      q.in = (c: string, v: unknown[]) => { where.push((r) => v.includes(valueOf(table, r, c))); return q }
      q.range = async (from: number, to: number) => ({ data: (h.tables[table] ?? []).filter((r) => where.every((f) => f(r))).slice(from, to + 1), error: null, status: 200 })
      q.upsert = async (rows: Row[]) => { h.ops.push({ table, op: 'upsert', rows }); return { error: null, status: 200 } }
      q.delete = () => {
        const filters: Record<string, unknown> = {}
        const d: Record<string, unknown> = {}
        d.eq = (c: string, v: unknown) => { filters[c] = v; return d }
        d.in = async (c: string, v: unknown) => { filters[c] = v; h.ops.push({ table, op: 'delete', filters }); return { error: null, status: 200 } }
        return d
      }
      return q
    },
  }),
}))
vi.mock('../sync-run', () => ({
  withRun: async (_s: string, store: string, fn: () => Promise<object>, isOk: (r: object) => boolean) => {
    const r = await fn()
    h.runs.push(`${store}:${isOk(r)}`)
    return r
  },
}))
vi.mock('../sync-lock', () => ({
  withLock: async (source: string, store: string, _ttl: number, fn: (l: { renew(): Promise<void> }) => Promise<object>) => {
    h.ops.push({ table: 'lock', op: `acquire ${source}/${store}` })
    return fn({ renew: async () => { h.ops.push({ table: 'lock', op: 'renew' }); if (h.lockLost) throw new Error('lock was lost') } })
  },
}))
vi.mock('./client', async (orig) => ({
  ...(await orig<typeof import('./client')>()),
  graphGet: async (path: string, params: Record<string, string | number> = {}) => {
    h.graph.calls.push({ path, params })
    const v = h.graph.info[path.replace('act_', '')]
    if (v instanceof Error) throw v
    return v
  },
  graphGetAll: async (path: string, params: Record<string, string | number>) => {
    h.graph.calls.push({ path, params })
    const id = /act_(\d+)/.exec(path)![1]
    if (path.endsWith('/campaigns')) return h.graph.campaigns[id] ?? []
    if (path.endsWith('/ads')) return h.graph.ads[id] ?? []
    if (params.level === 'account') {
      if (h.graph.accountDays[id]) return h.graph.accountDays[id]
      const by = new Map<string, number>()
      for (const d of (h.graph.days[id] ?? []) as { date_start: string; spend: string }[]) by.set(d.date_start, (by.get(d.date_start) ?? 0) + Number(d.spend))
      return [...by].map(([date_start, spend]) => ({ date_start, spend: spend.toFixed(2) }))
    }
    if (params.breakdowns && !h.graph.hours[id]) {
      // Unset: each day row in the hour window spent in one hour (noon), so the hours add up to the day.
      const { since } = JSON.parse(String(params.time_range)) as { since: string }
      return ((h.graph.days[id] ?? []) as Record<string, string>[]).filter((d) => d.date_start >= since)
        .map((d) => ({ ...d, hourly_stats_aggregated_by_advertiser_time_zone: '12:00:00 - 12:59:59' }))
    }
    return (params.breakdowns ? h.graph.hours[id] : h.graph.days[id]) ?? []
  },
}))

const { syncMeta, totalsMismatch } = await import('./sync')
const { MetaError } = await import('./client')

const OORVIA1 = '1338726490985485'
const OORVIA2 = '1447663743539549'
const KAIVEN = '1874064503928537'
const ok = { name: 'x', currency: 'INR', timezone_name: 'Asia/Kolkata', account_status: 1 }
const ad = (campaign_id: string, handle: string) => ({ campaign_id, creative: { link_url: `https://oorvia.com/products/${handle}` } })
const day = (campaign_id: string, spend: string, date = '2026-11-18') => ({ campaign_id, campaign_name: `name ${campaign_id}`, spend, impressions: '10', inline_link_clicks: '1', date_start: date })
const hour = (campaign_id: string, spend: string, h24: number, date = '2026-11-18') => ({ ...day(campaign_id, spend, date), hourly_stats_aggregated_by_advertiser_time_zone: `${String(h24).padStart(2, '0')}:00:00 - ${String(h24).padStart(2, '0')}:59:59` })
/** A stored cc_campaigns row. */
const stored = (campaign_id: string, ad_account_id = OORVIA1, landing_handle: string | null = null, store_id = 'oorvia') => ({ campaign_id, ad_account_id, landing_handle, store_id })
const upserts = (table: string) => (h.ops as Op[]).filter((o) => o.table === table && o.op === 'upsert')
const deletes = (table: string) => (h.ops as Op[]).filter((o) => o.table === table && o.op === 'delete')
const callsTo = (suffix: string) => h.graph.calls.filter((c) => c.path.endsWith(suffix))

beforeEach(() => {
  // 11:30 IST on 19 Nov: today is 2026-11-19, so the hour window is 18-19 Nov.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T06:00:00Z'))
  h.tables = {
    cc_products: [{ store_id: 'oorvia', handle: 'serum' }, { store_id: 'oorvia', handle: 'new-handle' }, { store_id: 'kaiven', handle: 'kaiven-only' }],
    cc_handle_aliases: [],
    cc_stores: [{ id: 'oorvia', shopify_domain: 'oorvia.myshopify.com' }],
    cc_campaigns: [], cc_campaign_days: [], cc_campaign_hours: [],
  }
  h.ops = []
  h.runs = []
  h.lockLost = false
  h.graph.info ={ [OORVIA1]: ok, [OORVIA2]: ok }
  h.graph.campaigns = {}
  h.graph.ads = {}
  h.graph.days = {}
  h.graph.hours = {}
  h.graph.accountDays = {}
  h.graph.calls = []
})
afterEach(() => { vi.useRealTimers() })

describe('syncMeta', () => {
  it('skips and reports a wrong-currency account while the other still syncs, and the run is ok:false', async () => {
    h.graph.info[OORVIA2] = { ...ok, currency: 'USD' }
    h.graph.campaigns[OORVIA1] = [{ id: 'c1', name: 'C1', effective_status: 'ACTIVE' }]
    h.graph.ads[OORVIA1] = [ad('c1', 'serum')]
    h.graph.days[OORVIA1] = [day('c1', '100.00')]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(r.ok).toBe(false)
    expect(r.accounts.map((a) => a.status)).toEqual(['ok', 'wrong_currency'])
    expect(r.skipped.join()).toMatch(/currency is USD/)
    expect(upserts('cc_campaign_days')[0].rows).toHaveLength(1)
    expect(h.runs).toEqual(['oorvia:false'])
  })

  it('skips a wrong-timezone account', async () => {
    h.graph.info[OORVIA2] = { ...ok, timezone_name: 'America/Los_Angeles' }
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(r.accounts[1].status).toBe('wrong_timezone')
    expect(r.skipped.join()).toMatch(/time zone is America\/Los_Angeles/)
  })

  it('reports no access for one account and still writes the other; the run stays ok', async () => {
    h.graph.info[OORVIA2] = new MetaError('no access', false, 'no_access', 200)
    h.graph.campaigns[OORVIA1] = [{ id: 'c1', name: 'C1', effective_status: 'ACTIVE' }]
    h.graph.ads[OORVIA1] = [ad('c1', 'serum')]
    h.graph.days[OORVIA1] = [day('c1', '50')]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(r.accounts.map((a) => a.status)).toEqual(['ok', 'no_access'])
    expect(r.skipped.join()).toMatch(/no access: the token in META_ACCESS_TOKEN cannot read this account/)
    expect(upserts('cc_campaign_days')).toHaveLength(1)
    expect(r.ok).toBe(true)
    expect(h.runs).toEqual(['oorvia:true'])
  })

  it('is not ok when every account is no_access (the store stays "not connected")', async () => {
    h.graph.info[OORVIA1] = new MetaError('no access', false, 'no_access', 200)
    h.graph.info[OORVIA2] = new MetaError('no access', false, 'no_access', 200)
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(r.ok).toBe(false)
    expect(h.runs).toEqual(['oorvia:false'])
  })

  it('rethrows a bad token instead of reporting it per account', async () => {
    h.graph.info[OORVIA1] = new MetaError('bad token', false, 'auth', 190)
    await expect(syncMeta('oorvia', { since: '2026-11-01' })).rejects.toThrow(/bad token/)
  })

  it('writes a campaign that only the insights mention before its day and hour rows, without a status or handle', async () => {
    h.graph.campaigns[OORVIA1] = []
    h.graph.days[OORVIA1] = [day('gone', '10')]
    h.graph.hours[OORVIA1] = [hour('gone', '2', 13)]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    const order = (h.ops as Op[]).filter((o) => o.op === 'upsert').map((o) => o.table)
    expect(order).toEqual(['cc_campaigns', 'cc_campaign_days', 'cc_campaign_hours'])
    const row = upserts('cc_campaigns')[0].rows![0]
    expect(row).toMatchObject({ campaign_id: 'gone', name: 'name gone', store_id: 'oorvia', ad_account_id: OORVIA1 })
    expect('status' in row).toBe(false)
    expect('landing_handle' in row).toBe(false)
    expect(r.skipped.join()).toMatch(/was deleted: its ads are gone/)
    expect(r.skipped.join()).not.toMatch(/link to no product page/)
  })

  it('does not report a deleted campaign that already has a stored handle', async () => {
    h.tables.cc_campaigns = [stored('gone', OORVIA1, 'serum')]
    h.graph.days[OORVIA1] = [day('gone', '10')]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(r.skipped).toEqual([])
  })

  it('omits landing_handle for an unresolved campaign (the stored one stays) and reports it only if it had spend', async () => {
    h.graph.campaigns[OORVIA1] = [
      { id: 'c1', name: 'resolved', effective_status: 'ACTIVE' }, { id: 'c2', name: 'no link', effective_status: 'PAUSED' }, { id: 'c3', name: 'idle', effective_status: 'PAUSED' },
    ]
    h.graph.ads[OORVIA1] = [ad('c1', 'serum'), { campaign_id: 'c2', creative: { link_url: 'https://oorvia.com/collections/all' } }]
    h.graph.days[OORVIA1] = [day('c1', '10'), day('c2', '5')]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    const rows = upserts('cc_campaigns').flatMap((o) => o.rows!)
    expect(rows.find((x) => x.campaign_id === 'c1')).toHaveProperty('landing_handle', 'serum')
    expect(rows.find((x) => x.campaign_id === 'c2')).not.toHaveProperty('landing_handle')
    expect(rows.find((x) => x.campaign_id === 'c3')).not.toHaveProperty('landing_handle')
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0]).toMatch(/"no link".*no product page/)
    expect(r.ok).toBe(true) // a report about a campaign is not an account failure
  })

  it('reports a campaign linking to two products and one whose handle matches no product', async () => {
    h.graph.campaigns[OORVIA1] = [{ id: 'c1', name: 'two', effective_status: 'ACTIVE' }, { id: 'c2', name: 'orphan', effective_status: 'ACTIVE' }]
    h.graph.ads[OORVIA1] = [ad('c1', 'serum'), ad('c1', 'new-handle'), ad('c2', 'nonexistent')]
    h.graph.days[OORVIA1] = [day('c1', '10'), day('c2', '5')]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(r.skipped.join('\n')).toMatch(/links to 2 products: new-handle, serum/)
    expect(r.skipped.join('\n')).toMatch(/matches no product of oorvia/)
  })

  it("matches handles only against this store's products", async () => {
    h.graph.campaigns[OORVIA1] = [{ id: 'c1', name: 'other store', effective_status: 'ACTIVE' }]
    h.graph.ads[OORVIA1] = [ad('c1', 'kaiven-only')]
    h.graph.days[OORVIA1] = [day('c1', '10')]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(r.skipped.join()).toMatch(/kaiven-only, which matches no product of oorvia/)
  })

  it('translates a renamed handle through the aliases before writing and before the no-product check', async () => {
    h.tables.cc_handle_aliases = [{ store_id: 'oorvia', old_handle: 'old-handle', handle: 'new-handle' }]
    h.graph.campaigns[OORVIA1] = [{ id: 'c1', name: 'renamed', effective_status: 'ACTIVE' }]
    h.graph.ads[OORVIA1] = [ad('c1', 'old-handle')]
    h.graph.days[OORVIA1] = [day('c1', '10')]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(upserts('cc_campaigns').flatMap((o) => o.rows!)[0]).toHaveProperty('landing_handle', 'new-handle')
    expect(r.skipped).toEqual([])
  })

  it("counts ads on a product's old and new handle as one product", async () => {
    h.tables.cc_handle_aliases = [{ store_id: 'oorvia', old_handle: 'old-handle', handle: 'new-handle' }]
    h.graph.campaigns[OORVIA1] = [{ id: 'c1', name: 'mixed', effective_status: 'ACTIVE' }, { id: 'c2', name: 'two', effective_status: 'ACTIVE' }]
    h.graph.ads[OORVIA1] = [ad('c1', 'old-handle'), ad('c1', 'new-handle'), ad('c2', 'old-handle'), ad('c2', 'serum')]
    h.graph.days[OORVIA1] = [day('c1', '10'), day('c2', '5')]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    const rows = upserts('cc_campaigns').flatMap((o) => o.rows!)
    expect(rows.find((x) => x.campaign_id === 'c1')).toHaveProperty('landing_handle', 'new-handle')
    expect(rows.find((x) => x.campaign_id === 'c2')).not.toHaveProperty('landing_handle')
    expect(r.skipped).toEqual(['campaign "two" (c2) in Oorvia-1 links to 2 products: new-handle, serum'])
  })

  it("ignores another store's alias", async () => {
    h.tables.cc_handle_aliases = [{ store_id: 'kaiven', old_handle: 'old-handle', handle: 'new-handle' }]
    h.graph.campaigns[OORVIA1] = [{ id: 'c1', name: 'renamed', effective_status: 'ACTIVE' }]
    h.graph.ads[OORVIA1] = [ad('c1', 'old-handle')]
    h.graph.days[OORVIA1] = [day('c1', '10')]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(upserts('cc_campaigns').flatMap((o) => o.rows!)[0]).toHaveProperty('landing_handle', 'old-handle')
    expect(r.skipped.join()).toMatch(/old-handle, which matches no product/)
  })

  it('does not send spend through an alias whose old handle is a live product again', async () => {
    // "serum" was renamed to "new-handle", then a new product took the handle "serum".
    h.tables.cc_handle_aliases = [{ store_id: 'oorvia', old_handle: 'serum', handle: 'new-handle' }]
    h.tables.cc_campaigns = [stored('idle', OORVIA1, 'serum')]
    h.graph.campaigns[OORVIA1] = [{ id: 'c1', name: 'live serum', effective_status: 'ACTIVE' }, { id: 'idle', name: 'idle', effective_status: 'PAUSED' }]
    h.graph.ads[OORVIA1] = [ad('c1', 'serum')]
    h.graph.days[OORVIA1] = [day('c1', '10')]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    const rows = upserts('cc_campaigns').flatMap((o) => o.rows!)
    expect(rows.find((x) => x.campaign_id === 'c1')).toHaveProperty('landing_handle', 'serum')
    expect(rows.find((x) => x.campaign_id === 'idle')).not.toHaveProperty('landing_handle') // stored "serum" stays
    expect(r.skipped).toEqual([])
  })

  it('moves a stored handle that has been renamed even when the campaign is not re-read', async () => {
    h.tables.cc_handle_aliases = [{ store_id: 'oorvia', old_handle: 'old-handle', handle: 'new-handle' }]
    h.tables.cc_campaigns = [stored('c1', OORVIA1, 'old-handle')]
    h.graph.campaigns[OORVIA1] = [{ id: 'c1', name: 'idle', effective_status: 'PAUSED' }]
    await syncMeta('oorvia', { since: '2026-11-01' })
    expect(callsTo('/ads')).toHaveLength(0)
    expect(upserts('cc_campaigns').flatMap((o) => o.rows!)[0]).toHaveProperty('landing_handle', 'new-handle')
  })

  it('reads ads only for campaigns that are new, have no stored handle, or spent in the window', async () => {
    h.tables.cc_campaigns = [stored('c1', OORVIA1, 'serum')]
    h.graph.campaigns[OORVIA1] = [{ id: 'c1', name: 'known idle', effective_status: 'PAUSED' }]
    await syncMeta('oorvia', { since: '2026-11-01' })
    expect(callsTo('/ads')).toHaveLength(0)

    h.graph.campaigns[OORVIA1] = [{ id: 'c1', name: 'known idle', effective_status: 'PAUSED' }, { id: 'c9', name: 'new', effective_status: 'ACTIVE' }]
    await syncMeta('oorvia', { since: '2026-11-01' })
    expect(callsTo('/ads')).toHaveLength(1)
    expect(JSON.parse(String(callsTo('/ads')[0].params.filtering))).toEqual([{ field: 'campaign.id', operator: 'IN', value: ['c9'] }])
  })

  it('a campaign stored under the other Oorvia account does not count as known for this one', async () => {
    h.tables.cc_campaigns = [stored('c1', OORVIA2, 'serum')]
    h.graph.campaigns[OORVIA1] = [{ id: 'c1', name: 'idle', effective_status: 'PAUSED' }]
    await syncMeta('oorvia', { since: '2026-11-01' })
    expect(callsTo('/ads').map((c) => c.path)).toEqual([`act_${OORVIA1}/ads`])
  })

  it('asks Meta for archived campaigns and ads, never DELETED on those edges, and for deleted campaigns in the insights', async () => {
    h.graph.campaigns[OORVIA1] = [{ id: 'c1', name: 'C1', effective_status: 'ARCHIVED' }]
    await syncMeta('oorvia', { since: '2026-11-01' })
    const campaignStatuses = JSON.parse(String(callsTo('/campaigns')[0].params.effective_status))
    expect(campaignStatuses).toEqual(['ACTIVE', 'PAUSED', 'ARCHIVED', 'IN_PROCESS', 'WITH_ISSUES'])
    const adStatuses = JSON.parse(String(callsTo('/ads')[0].params.effective_status))
    expect(adStatuses).toContain('ARCHIVED')
    expect(adStatuses).not.toContain('DELETED')

    const insights = callsTo(`act_${OORVIA1}/insights`)
    const [daily, hourly, account] = insights
    expect(insights).toHaveLength(3)
    for (const c of [daily, hourly]) {
      expect(c.params).toMatchObject({ level: 'campaign', time_increment: 1, use_unified_attribution_setting: 'true' })
      const [f] = JSON.parse(String(c.params.filtering))
      expect(f).toMatchObject({ field: 'campaign.effective_status', operator: 'IN' })
      expect(f.value).toEqual(expect.arrayContaining(['ARCHIVED', 'DELETED']))
    }
    expect(JSON.parse(String(daily.params.time_range))).toEqual({ since: '2026-11-01', until: '2026-11-19' })
    expect(daily.params.breakdowns).toBeUndefined()
    expect(hourly.params.breakdowns).toBe('hourly_stats_aggregated_by_advertiser_time_zone')
    expect(JSON.parse(String(hourly.params.time_range))).toEqual({ since: '2026-11-18', until: '2026-11-19' })
    // The safety total must not be status-filtered, or it would hide the very spend it is there to catch.
    expect(account.params).toMatchObject({ level: 'account', fields: 'spend', time_increment: 1, use_unified_attribution_setting: 'true' })
    expect(account.params.filtering).toBeUndefined()
    expect(JSON.parse(String(account.params.time_range))).toEqual({ since: '2026-11-01', until: '2026-11-19' })
  })

  it('defaults to the last 7 days plus today', async () => {
    const r = await syncMeta('oorvia')
    expect([r.since, r.until]).toEqual(['2026-11-12', '2026-11-19'])
  })

  it('warns about an inactive account but still syncs it', async () => {
    h.graph.info[OORVIA1] = { ...ok, account_status: 2 }
    h.graph.days[OORVIA1] = [day('c1', '10')]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(r.warnings.join()).toMatch(/account status is 2/)
    expect(r.accounts[0].status).toBe('ok')
    expect(r.ok).toBe(true)
  })

  it('totals spend in paise across accounts', async () => {
    h.graph.days[OORVIA1] = [day('c1', '10.50'), day('c1', '4.25', '2026-11-17')]
    h.graph.days[OORVIA2] = [day('c2', '1')]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(r.spend_paise).toBe(1050 + 425 + 100)
    expect(r.day_rows).toBe(3)
  })

  it('records a run per real sync', async () => {
    await syncMeta('oorvia', { since: '2026-11-01' })
    expect(h.runs).toEqual(['oorvia:true'])
  })

  it("holds the store's lock and renews it before each account writes", async () => {
    h.graph.days[OORVIA1] = [day('c1', '10')]
    h.graph.days[OORVIA2] = [day('c2', '5')]
    await syncMeta('oorvia', { since: '2026-11-01' })
    const seq = (h.ops as Op[]).map((o) => (o.table === 'lock' ? `lock ${o.op}` : `${o.op}:${o.table}`)).filter((x) => x.startsWith('lock') || x === 'upsert:cc_campaigns')
    expect(seq).toEqual(['lock acquire meta/oorvia', 'lock renew', 'upsert:cc_campaigns', 'lock renew', 'upsert:cc_campaigns'])
  })

  it('writes and deletes nothing once the lock is lost', async () => {
    h.lockLost = true
    h.tables.cc_campaigns = [stored('c1')]
    h.tables.cc_campaign_days = [{ campaign_id: 'c1', date: '2026-11-17' }]
    h.graph.days[OORVIA1] = [day('c1', '10')]
    await expect(syncMeta('oorvia', { since: '2026-11-01' })).rejects.toThrow(/lock was lost/)
    expect((h.ops as Op[]).filter((o) => o.table !== 'lock')).toEqual([])
  })

  it('a dry run takes no lock', async () => {
    await syncMeta('oorvia', { since: '2026-11-01', dryRun: true })
    expect(h.ops).toEqual([])
  })
})

describe('stale rows', () => {
  /** c1 on Oorvia-1 spent on 18 Nov; Meta returns nothing else for either account. */
  function oneCampaign() {
    h.tables.cc_campaigns = [stored('c1', OORVIA1, 'serum')]
    h.graph.campaigns[OORVIA1] = [{ id: 'c1', name: 'C1', effective_status: 'ACTIVE' }]
    h.graph.ads[OORVIA1] = [ad('c1', 'serum')]
    h.graph.days[OORVIA1] = [day('c1', '10', '2026-11-18')]
    h.graph.hours[OORVIA1] = [hour('c1', '10', 14)]
  }

  it("deletes only this account's rows in the window that Meta no longer returns, after writing the fresh ones", async () => {
    oneCampaign()
    h.tables.cc_campaigns.push(stored('k1', KAIVEN, null, 'kaiven'), stored('c2', OORVIA2, 'serum'))
    h.tables.cc_campaign_days = [
      { campaign_id: 'c1', date: '2026-11-18' }, // returned: kept
      { campaign_id: 'c1', date: '2026-11-17' }, // stale
      { campaign_id: 'c1', date: '2026-10-31' }, // before the window: kept
      { campaign_id: 'k1', date: '2026-11-17' }, // another store's account: kept
    ]
    h.tables.cc_campaign_hours = [
      { campaign_id: 'c1', date: '2026-11-18', hour: 14 }, // returned: kept
      { campaign_id: 'c1', date: '2026-11-18', hour: 9 }, // stale
      { campaign_id: 'c1', date: '2026-11-17', hour: 9 }, // before the hour window: kept
      { campaign_id: 'k1', date: '2026-11-18', hour: 9 }, // another store's account: kept
    ]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(deletes('cc_campaign_days').map((o) => o.filters)).toEqual([{ campaign_id: 'c1', date: ['2026-11-17'] }])
    expect(deletes('cc_campaign_hours').map((o) => o.filters)).toEqual([{ campaign_id: 'c1', date: '2026-11-18', hour: [9] }])
    // Oorvia-2 returned nothing, and had nothing stored in the window: it deletes nothing of Oorvia-1's.
    expect([r.stale_days_removed, r.stale_hours_removed]).toEqual([1, 1])
    const kinds = (h.ops as Op[]).map((o) => `${o.op}:${o.table}`)
    expect(kinds.indexOf('delete:cc_campaign_days')).toBeGreaterThan(kinds.lastIndexOf('upsert:cc_campaign_days'))
  })

  it("deletes the other Oorvia account's rows only on that account's own pass", async () => {
    oneCampaign()
    h.tables.cc_campaigns.push(stored('c2', OORVIA2, 'serum'))
    h.tables.cc_campaign_days = [{ campaign_id: 'c1', date: '2026-11-18' }, { campaign_id: 'c2', date: '2026-11-16' }]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(deletes('cc_campaign_days').map((o) => o.filters)).toEqual([{ campaign_id: 'c2', date: ['2026-11-16'] }])
    expect(r.stale_days_removed).toBe(1)
  })

  it('deletes nothing when campaign spend and the account total disagree by more than 1 rupee, but still writes', async () => {
    oneCampaign()
    h.graph.accountDays[OORVIA1] = [{ date_start: '2026-11-18', spend: '11.01' }]
    h.tables.cc_campaign_days = [{ campaign_id: 'c1', date: '2026-11-17' }]
    h.tables.cc_campaign_hours = [{ campaign_id: 'c1', date: '2026-11-18', hour: 9 }]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(deletes('cc_campaign_days')).toEqual([])
    expect(deletes('cc_campaign_hours')).toEqual([])
    expect([r.stale_days_removed, r.stale_hours_removed]).toEqual([0, 0])
    expect(r.skipped.join()).toMatch(/does not match the account total \(2026-11-18: account 11\.01 vs campaigns 10\.00\): stale rows were not deleted/)
    expect(upserts('cc_campaign_days')[0].rows).toHaveLength(1)
  })

  it("only warns when today's totals disagree (still coming in), and still deletes nothing", async () => {
    oneCampaign()
    h.graph.days[OORVIA1].push(day('c1', '1906.21', '2026-11-19'))
    h.graph.accountDays[OORVIA1] = [{ date_start: '2026-11-18', spend: '10.00' }, { date_start: '2026-11-19', spend: '1879.61' }]
    h.tables.cc_campaign_days = [{ campaign_id: 'c1', date: '2026-11-17' }]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(r.skipped).toEqual([])
    expect(r.warnings.join()).toMatch(/today's campaign spend does not match the account total yet \(2026-11-19: account 1879\.61 vs campaigns 1906\.21\)/)
    expect(deletes('cc_campaign_days')).toEqual([])
    expect(r.stale_days_removed).toBe(0)
  })

  it('reports an earlier day that disagrees even when today does too', async () => {
    oneCampaign()
    h.graph.days[OORVIA1].push(day('c1', '1906.21', '2026-11-19'))
    h.graph.accountDays[OORVIA1] = [{ date_start: '2026-11-18', spend: '12.00' }, { date_start: '2026-11-19', spend: '1879.61' }]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(r.skipped.join()).toMatch(/does not match the account total \(2026-11-18: account 12\.00 vs campaigns 10\.00\)/)
    expect(r.warnings).toEqual([])
  })

  it('keeps stored hours when the hourly answer is empty but the day had spend (reported), and still cleans day rows', async () => {
    oneCampaign()
    h.graph.days[OORVIA1] = [day('c1', '100', '2026-11-18')]
    h.graph.hours[OORVIA1] = []
    h.tables.cc_campaign_days = [{ campaign_id: 'c1', date: '2026-11-17' }]
    h.tables.cc_campaign_hours = [{ campaign_id: 'c1', date: '2026-11-18', hour: 14 }]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(deletes('cc_campaign_hours')).toEqual([])
    expect(r.stale_hours_removed).toBe(0)
    expect(r.skipped.join()).toMatch(/hourly spend does not add up to the day's spend \(2026-11-18: daily 100\.00 vs hourly 0\.00\): stale hour rows were not deleted/)
    expect(deletes('cc_campaign_days')).toHaveLength(1)
  })

  it("only warns when today's hours lag the day, and keeps today's and yesterday's stored hours", async () => {
    oneCampaign()
    h.graph.days[OORVIA1].push(day('c1', '50', '2026-11-19'))
    h.graph.hours[OORVIA1].push(hour('c1', '30', 10, '2026-11-19'))
    h.tables.cc_campaign_hours = [{ campaign_id: 'c1', date: '2026-11-18', hour: 9 }, { campaign_id: 'c1', date: '2026-11-19', hour: 11 }]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(deletes('cc_campaign_hours')).toEqual([])
    expect(r.skipped).toEqual([])
    expect(r.warnings.join()).toMatch(/today's hourly spend does not add up to the day's spend yet \(2026-11-19: daily 50\.00 vs hourly 30\.00\)/)
  })

  it('ignores days before the hour window when checking hours', async () => {
    oneCampaign()
    h.graph.days[OORVIA1].push(day('c1', '500', '2026-11-10')) // no hours are fetched for it
    h.tables.cc_campaign_hours = [{ campaign_id: 'c1', date: '2026-11-18', hour: 9 }]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(r.stale_hours_removed).toBe(1)
    expect(r.skipped).toEqual([])
  })

  it('still deletes within the 1 rupee tolerance', async () => {
    oneCampaign()
    h.graph.accountDays[OORVIA1] = [{ date_start: '2026-11-18', spend: '11.00' }]
    h.tables.cc_campaign_days = [{ campaign_id: 'c1', date: '2026-11-17' }]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(r.stale_days_removed).toBe(1)
    expect(deletes('cc_campaign_days')).toHaveLength(1)
  })

  it('deletes no hour rows, but still day rows, when an hourly row has no readable hour bucket', async () => {
    oneCampaign()
    h.graph.hours[OORVIA1].push({ ...day('c1', '1'), hourly_stats_aggregated_by_advertiser_time_zone: 'garbage' })
    h.tables.cc_campaign_days = [{ campaign_id: 'c1', date: '2026-11-17' }]
    h.tables.cc_campaign_hours = [{ campaign_id: 'c1', date: '2026-11-18', hour: 9 }]
    const r = await syncMeta('oorvia', { since: '2026-11-01' })
    expect(deletes('cc_campaign_hours')).toEqual([])
    expect(deletes('cc_campaign_days')).toHaveLength(1)
    expect(r.skipped.join()).toMatch(/no readable hour bucket: stale hour rows were not deleted/)
    expect(upserts('cc_campaign_hours')[0].rows).toHaveLength(1) // the readable one is still written
  })

  it('does not delete anything when no account could be fetched', async () => {
    h.tables.cc_campaigns = [stored('c1')]
    h.tables.cc_campaign_days = [{ campaign_id: 'c1', date: '2026-11-18' }]
    h.graph.info[OORVIA1] = new MetaError('no access', false, 'no_access', 200)
    h.graph.info[OORVIA2] = new MetaError('no access', false, 'no_access', 200)
    await syncMeta('oorvia', { since: '2026-11-01' })
    expect(deletes('cc_campaign_days')).toEqual([])
  })

  it('dry run reads and plans but writes nothing, and records no run', async () => {
    oneCampaign()
    h.tables.cc_campaign_days = [{ campaign_id: 'c1', date: '2026-11-17' }]
    const r = await syncMeta('oorvia', { since: '2026-11-01', dryRun: true })
    expect(h.ops).toEqual([])
    expect(h.runs).toEqual([])
    expect(r.plan?.campaigns).toEqual([{ id: 'c1', name: 'C1', handle: 'serum', status: 'ACTIVE', spend_paise: 1000 }])
    expect(r.stale_days_removed).toBe(1) // counted, not deleted
  })
})

describe('totalsMismatch', () => {
  const camp = (date: string, spend_paise: number) => ({ date, spend_paise }) as Parameters<typeof totalsMismatch>[1][number]
  it('is null when every day matches within 100 paise', () => {
    expect(totalsMismatch([{ date_start: '2026-11-18', spend: '10.00' }], [camp('2026-11-18', 600), camp('2026-11-18', 500)])).toBeNull()
    expect(totalsMismatch([], [])).toBeNull()
  })
  it('names the first day the account spent on that the campaigns are missing', () => {
    expect(totalsMismatch([{ date_start: '2026-11-17', spend: '5.00' }, { date_start: '2026-11-18', spend: '1.00' }], [camp('2026-11-18', 100)]))
      .toBe('2026-11-17: account 5.00 vs campaigns 0.00')
  })
  it('flags campaign spend on a day the account shows none', () => {
    expect(totalsMismatch([], [camp('2026-11-18', 250)])).toBe('2026-11-18: account 0.00 vs campaigns 2.50')
  })
})
