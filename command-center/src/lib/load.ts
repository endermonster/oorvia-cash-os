/**
 * Reads the Command Center's Supabase views and maps them onto the data contract in
 * ./types. The row to contract mapping is in small pure functions so it can be tested
 * without a database. Numeric columns can arrive from PostgREST as strings: every
 * number goes through Number().
 */
import type { Chrome, Data } from './data'
import { addDays, istNow } from './dates'
import { metaStoreIds } from './meta/accounts'
import { selectAll } from './paged'
import type {
  Campaign, CampaignDay, CampaignHour, OrderDay, OrderHour, OrderPayment, Product, ProductStage, RecentOrder, ResolvedDay,
  Store, StoreId, SyncStatus,
} from './types'

type Num = number | string

// ── Row shapes (snake_case, as the views return them) ───────────────────────

export type StoreRow = {
  id: string; name: string; live_since: string | null; gateways: string[] | null; gateway_pct: Num
}
export type ProductRow = {
  store_id: string; sku: string; name: string; price_paise: Num; packed_weight_grams: Num; handle: string; stage: string; live_since: string | null
}
export type CogsRow = { store_id: string; sku: string; cogs_paise: Num; effective_from: string }
export type OrderDayRow = {
  date: string; store_id: string; sku: string; payment: string; orders: Num; units: Num; revenue: Num; cogs: Num; slabs500: Num; slabs_kg: Num
  /** Only on cc_order_days. */
  orders_missing_cogs?: Num
}
export type OrderHourRow = OrderDayRow & { hour: Num }
export type ResolvedRow = { closed_on: string; store_id: string; sku: string; payment: string; delivered: Num; rto: Num }
export type CampaignDayRow = {
  date: string; store_id: string; campaign_id: string; sku: string | null
  spend: Num; impressions: Num; clicks: Num; meta_purchases: Num; attributed_orders: Num
}
export type CampaignHourRow = CampaignDayRow & { hour: Num }
export type CampaignRow = { campaign_id: string; store_id: string; name: string; landing_handle: string | null }
export type OrderRow = {
  store_id: string; order_name: string; placed_at: string; payment: string; total_paise: Num; primary_sku: string; city: string | null
}
export type SyncRunRow = { source: string; store_id: string | null; finished_at: string; ok: boolean }

// ── Pure mapping ─────────────────────────────────────────────────────────────

const n = (v: Num) => Number(v)
const sid = (v: string) => v as StoreId
const pay = (v: string) => v as OrderPayment

export const mapStore = (r: StoreRow): Store => ({
  id: sid(r.id), name: r.name, liveSince: r.live_since ?? '', gateways: r.gateways ?? [], gatewayPct: n(r.gateway_pct),
})

/** Oldest store first, then by name: Oorvia, Kaiven, Selnova. */
export const sortStores = (stores: Store[]): Store[] =>
  [...stores].sort((a, b) => a.liveSince.localeCompare(b.liveSince) || a.name.localeCompare(b.name))

/** Today's cost per (store, SKU): the latest entry starting on or before `today`, in rupees. Keyed `store:sku`. */
export function currentCogs(rows: CogsRow[], today: string): Map<string, number> {
  const best = new Map<string, CogsRow>()
  for (const r of rows) {
    if (r.effective_from > today) continue
    const key = `${r.store_id}:${r.sku}`
    const hit = best.get(key)
    if (!hit || r.effective_from > hit.effective_from) best.set(key, r)
  }
  return new Map([...best].map(([k, r]) => [k, n(r.cogs_paise) / 100]))
}

/** A product with no cost on record gets `cogs: null`, never 0: its breakeven is not computed. */
export function mapProduct(r: ProductRow, cogs: Map<string, number>): Product {
  return {
    sku: r.sku, storeId: sid(r.store_id), name: r.name, price: n(r.price_paise) / 100, cogs: cogs.get(`${r.store_id}:${r.sku}`) ?? null,
    packedWeightGrams: n(r.packed_weight_grams), liveSince: r.live_since ?? '', handle: r.handle, stage: r.stage as ProductStage,
  }
}

const orderAmounts = (r: OrderDayRow) => ({
  storeId: sid(r.store_id), sku: r.sku, payment: pay(r.payment),
  orders: n(r.orders), units: n(r.units), revenue: n(r.revenue), cogs: n(r.cogs), slabs500: n(r.slabs500), slabsKg: n(r.slabs_kg),
})
export const mapOrderDay = (r: OrderDayRow): OrderDay => ({ date: r.date, ...orderAmounts(r), ordersMissingCogs: n(r.orders_missing_cogs ?? 0) })
export const mapOrderHour = (r: OrderHourRow): OrderHour => ({ hour: n(r.hour), ...orderAmounts(r) })

export const mapResolvedDay = (r: ResolvedRow): ResolvedDay => ({
  closedOn: r.closed_on, storeId: sid(r.store_id), sku: r.sku, payment: pay(r.payment), delivered: n(r.delivered), rto: n(r.rto),
})

const campaignAmounts = (r: CampaignDayRow) => ({
  storeId: sid(r.store_id), campaignId: r.campaign_id, sku: r.sku ?? null,
  spend: n(r.spend), impressions: n(r.impressions), clicks: n(r.clicks), metaPurchases: n(r.meta_purchases), attributedOrders: n(r.attributed_orders),
})
export const mapCampaignDay = (r: CampaignDayRow): CampaignDay => ({ date: r.date, ...campaignAmounts(r) })
export const mapCampaignHour = (r: CampaignHourRow): CampaignHour => ({ hour: n(r.hour), ...campaignAmounts(r) })

/** A campaign sells the product in its store whose handle matches its landing handle; null if none does. */
export function mapCampaign(r: CampaignRow, products: Product[]): Campaign {
  const p = r.landing_handle ? products.find((x) => x.storeId === r.store_id && x.handle === r.landing_handle) : undefined
  return { id: r.campaign_id, storeId: sid(r.store_id), sku: p?.sku ?? null, name: r.name }
}

export function mapRecentOrder(r: OrderRow, products: Product[]): RecentOrder {
  const p = products.find((x) => x.storeId === r.store_id && x.sku === r.primary_sku)
  return {
    id: `${r.store_id}:${r.order_name}`, storeId: sid(r.store_id), placedAt: new Date(r.placed_at).toISOString(),
    sku: r.primary_sku, product: p?.name ?? r.primary_sku, value: n(r.total_paise) / 100, payment: pay(r.payment), city: r.city ?? '—',
  }
}

// Exact source names, as constrained in cc_sync_runs. shopify_products and vf_transactions are not freshness signals.
const SHOPIFY_SOURCES = ['shopify_webhook', 'shopify_backfill']
const VFULFILL_SOURCES = ['vf_shipments']
const META_SOURCES = ['meta']

/**
 * Freshness per source: each store's latest successful run (a run with a null store_id counts for every
 * store), then the OLDEST across stores, so one stale store makes the whole source stale. Null = never.
 * Meta is only expected for `metaStoreIds` (stores with an allowlisted ad account); one that never synced is
 * listed in `metaNotConnected` and does not hold the age back.
 */
// A quiet store (no orders for days) has no recent webhook, so "the oldest store" can look stale although nothing is
// wrong. The daily cron (deploy stage) runs `--orders --since yesterday` per store, which writes a shopify_backfill
// run for every store and keeps this honest.
export function mapSync(runs: SyncRunRow[], storeIds: string[], now: Date, metaStoreIds: string[] = storeIds): SyncStatus {
  // `skipUnseen`: a store with no ok run ever is left out instead of making the whole source "never" (Meta only).
  const unseen: string[] = []
  const oldestLatest = (sources: string[], ids: string[], skipUnseen = false): number | null => {
    let oldest: number | null = null
    for (const id of ids) {
      const ts = runs
        .filter((r) => r.ok && sources.includes(r.source) && (r.store_id === id || r.store_id === null))
        .map((r) => Date.parse(r.finished_at))
      if (ts.length === 0) {
        if (skipUnseen) { unseen.push(id); continue }
        return null
      }
      const latest = Math.max(...ts)
      oldest = oldest === null ? latest : Math.min(oldest, latest)
    }
    return oldest
  }
  const age = (t: number | null) => (t === null ? null : Math.max(0, now.getTime() - t))
  const minutes = (t: number | null) => { const a = age(t); return a === null ? null : Math.round(a / 60000) }
  const days = (t: number | null) => { const a = age(t); return a === null ? null : Math.floor(a / 864e5) }
  // A store that synced once and later loses access keeps its last ok time (it goes stale); only a store that never synced is "not connected".
  const metaMinutesAgo = minutes(oldestLatest(META_SOURCES, metaStoreIds, true))
  return {
    metaMinutesAgo,
    metaNotConnected: unseen.map(sid),
    shopifyMinutesAgo: minutes(oldestLatest(SHOPIFY_SOURCES, storeIds)),
    vfulfillImportDaysAgo: days(oldestLatest(VFULFILL_SOURCES, storeIds)),
  }
}

/** Stores a Meta sync is expected for: those with an allowlisted ad account (a constant, not cc_stores.meta_ad_account_id). */
export const metaStoresAmong = (storeIds: string[]): string[] => metaStoreIds().filter((id) => storeIds.includes(id))

// ── Read ─────────────────────────────────────────────────────────────────────

/** How far back the day-level reads go: 30D + its comparison, and this month + last month, with room. */
const HISTORY_DAYS = 70
const RECENT_LIMIT = 20

type Client = Awaited<ReturnType<typeof getClient>>
async function getClient() {
  // Lazy: keeps the server-only client out of anything that only needs the mapping functions.
  const { supabase } = await import('./supabase')
  return supabase()
}

async function readStores(sb: Client): Promise<{ stores: Store[]; metaStoreIds: string[] }> {
  const rows = await selectAll<StoreRow>(() => sb.from('cc_stores').select('id, name, live_since, gateways, gateway_pct').order('id'))
  return { stores: sortStores(rows.map(mapStore)), metaStoreIds: metaStoresAmong(rows.map((r) => r.id)) }
}

/** Latest successful run per (source group, store), one-row queries. A null store_id run counts for every store. */
async function readSync(sb: Client, storeIds: string[], metaStoreIds: string[], now: Date): Promise<SyncStatus> {
  const groups: [string[], string[]][] = [[SHOPIFY_SOURCES, storeIds], [VFULFILL_SOURCES, storeIds], [META_SOURCES, metaStoreIds]]
  const runs = (await Promise.all(groups.flatMap(([sources, ids]) => ids.map(async (id) => {
    const { data, error } = await sb.from('cc_sync_runs').select('source, store_id, finished_at, ok')
      .in('source', sources).eq('ok', true).or(`store_id.eq.${id},store_id.is.null`)
      .order('finished_at', { ascending: false }).limit(1)
    if (error) throw new Error(error.message)
    return (data ?? []) as SyncRunRow[]
  })))).flat()
  return mapSync(runs, storeIds, now, metaStoreIds)
}

export async function loadChrome(): Promise<Chrome> {
  const sb = await getClient()
  const now = new Date()
  const { stores, metaStoreIds } = await readStores(sb)
  return { now, source: 'supabase', stores, sync: await readSync(sb, stores.map((s) => s.id), metaStoreIds, now) }
}

export async function loadData(): Promise<Data> {
  const sb = await getClient()
  const now = new Date()
  const { today, hour: nowHour, minute: nowMinute } = istNow(now)
  const yesterday = addDays(today, -1)
  const since = addDays(today, -HISTORY_DAYS)

  const orderCols = 'store_id, sku, payment, orders, units, revenue, cogs, slabs500, slabs_kg'
  const dayCols = `${orderCols}, orders_missing_cogs`
  const campCols = 'store_id, campaign_id, sku, spend, impressions, clicks, meta_purchases, attributed_orders'

  const [{ stores, metaStoreIds }, productRows, cogsRows, orders, ordersToday, ordersYesterday, campaignRows, campaignDays, campsToday, campsYesterday, resolved, recent] =
    await Promise.all([
      readStores(sb),
      selectAll<ProductRow>(() => sb.from('cc_products').select('store_id, sku, name, price_paise, packed_weight_grams, handle, stage, live_since').order('store_id').order('sku')),
      selectAll<CogsRow>(() => sb.from('cc_cogs_history').select('store_id, sku, cogs_paise, effective_from').order('store_id').order('sku').order('effective_from')),
      selectAll<OrderDayRow>(() => sb.from('cc_order_days').select(`date, ${dayCols}`).gte('date', since).order('date').order('store_id').order('sku').order('payment')),
      selectAll<OrderHourRow>(() => sb.from('cc_order_hours').select(`hour, ${orderCols}`).eq('date', today).order('hour').order('store_id').order('sku').order('payment')),
      selectAll<OrderHourRow>(() => sb.from('cc_order_hours').select(`hour, ${orderCols}`).eq('date', yesterday).order('hour').order('store_id').order('sku').order('payment')),
      selectAll<CampaignRow>(() => sb.from('cc_campaigns').select('campaign_id, store_id, name, landing_handle').order('store_id').order('campaign_id')),
      selectAll<CampaignDayRow>(() => sb.from('cc_campaign_day_rows').select(`date, ${campCols}`).gte('date', since).order('date').order('store_id').order('campaign_id').order('sku')),
      selectAll<CampaignHourRow>(() => sb.from('cc_campaign_hour_rows').select(`hour, ${campCols}`).eq('date', today).order('hour').order('store_id').order('campaign_id').order('sku')),
      selectAll<CampaignHourRow>(() => sb.from('cc_campaign_hour_rows').select(`hour, ${campCols}`).eq('date', yesterday).order('hour').order('store_id').order('campaign_id').order('sku')),
      selectAll<ResolvedRow>(() => sb.from('cc_resolved_days').select('closed_on, store_id, sku, payment, delivered, rto').order('closed_on').order('store_id').order('sku').order('payment')),
      // The 20 newest real orders: one small read, not paged.
      sb.from('cc_orders').select('store_id, order_name, placed_at, payment, total_paise, primary_sku, city')
        .is('cancelled_at', null).eq('is_test', false).order('placed_at', { ascending: false }).limit(RECENT_LIMIT)
        .then(({ data, error }): OrderRow[] => {
          if (error) throw new Error(error.message)
          return (data ?? []) as OrderRow[]
        }),
    ])

  const cogs = currentCogs(cogsRows, today)
  const products = productRows.map((r) => mapProduct(r, cogs))
  return {
    now, today, nowHour, nowMinute, source: 'supabase',
    stores,
    products,
    orders: orders.map(mapOrderDay),
    orderHours: ordersToday.map(mapOrderHour),
    orderHoursYesterday: ordersYesterday.map(mapOrderHour),
    campaigns: campaignRows.map((r) => mapCampaign(r, products)),
    campaignDays: campaignDays.map(mapCampaignDay),
    campaignHours: campsToday.map(mapCampaignHour),
    campaignHoursYesterday: campsYesterday.map(mapCampaignHour),
    resolved: resolved.map(mapResolvedDay),
    recentOrders: recent.map((r) => mapRecentOrder(r, products)),
    cash: null, gst: null, fixedCostsMonthly: null,
    sync: await readSync(sb, stores.map((s) => s.id), metaStoreIds, now),
  }
}
