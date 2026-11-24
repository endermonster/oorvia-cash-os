/**
 * Reads the Command Center's Supabase views and maps them onto the data contract in
 * ./types. The row to contract mapping is in small pure functions so it can be tested
 * without a database. Numeric columns can arrive from PostgREST as strings: every
 * number goes through Number().
 */
import type { Chrome, Data } from './data'
import { addDays, istNow } from './dates'
import { metaStoreIds } from './meta/accounts'
import { mapFundsRow, type FundsRow } from './meta/funds-level'
import { selectAll } from './paged'
import { monthlyRunRate, type FixedCost } from './pnl'
import { estimateSettlements, LOOKBACK_DAYS, type SettlementEstimate } from './settlements'
import { coverageChecks, SHIP_LAG_DAYS } from './vfulfill/shipments'
import type {
  AdAccountFunds, Campaign, CampaignDay, CampaignHour, CashPosition, OrderDay, OrderHour, OrderPayment, Product, ProductStage, RecentOrder, ResolvedDay,
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
export type CampaignRow = { campaign_id: string; store_id: string; name: string; landing_handle: string | null; status: string | null }
export type OrderRow = {
  store_id: string; order_name: string; placed_at: string; payment: string; total_paise: Num; primary_sku: string; city: string | null
}
/** `detail`: the run's result as JSON text (see ./sync-run); only Meta's is read. */
export type SyncRunRow = { source: string; store_id: string | null; finished_at: string; ok: boolean; detail?: string | null }
export type WalletRow = { balance: Num; last_txn_date: string | null; transactions: Num }
export type CodDueRow = { store_id: string; orders: Num; paise: Num }
export type BankRow = { amount_paise: Num; entered_on: string }

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
  return { id: r.campaign_id, storeId: sid(r.store_id), sku: p?.sku ?? null, name: r.name, status: r.status }
}

export function mapRecentOrder(r: OrderRow, products: Pick<Product, 'storeId' | 'sku' | 'name'>[]): RecentOrder {
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
export function mapSync(
  runs: SyncRunRow[], storeIds: string[], now: Date, metaStoreIds: string[] = storeIds, shipmentsThrough: string | null = null,
  missingStores: { storeId: string; seenAt: string }[] = [], overdueOrders: number | null = null, openShipments: number | null = null,
): Omit<SyncStatus, 'adAccountFunds'> {
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
  const metaMinutesAgoByStore: SyncStatus['metaMinutesAgoByStore'] = {}
  const metaYesterdayVerified: SyncStatus['metaYesterdayVerified'] = {}
  for (const id of metaStoreIds) {
    const ok = runs.filter((r) => r.ok && META_SOURCES.includes(r.source) && (r.store_id === id || r.store_id === null))
    if (ok.length === 0) continue
    const latest = ok.reduce((a, b) => (Date.parse(b.finished_at) > Date.parse(a.finished_at) ? b : a))
    metaMinutesAgoByStore[sid(id)] = minutes(Date.parse(latest.finished_at))!
    metaYesterdayVerified[sid(id)] = verifiedYesterday(latest.detail)
  }
  const daysSince = (day: string) => Math.max(0, Math.floor((Date.parse(istNow(now).today) - Date.parse(day.slice(0, 10))) / 864e5))
  // The worse of the newest closed shipment and any store left out of the newest import (aged from its own last one).
  // An old closed shipment is not stale data when no order since is waiting on vFulfill and no recent shipment is still
  // open (a quiet store with nothing to ship or deliver).
  const current = overdueOrders === 0 && (openShipments ?? 0) === 0
  const ages = [
    ...(shipmentsThrough === null || current ? [] : [daysSince(shipmentsThrough)]),
    ...missingStores.map((m) => daysSince(istNow(new Date(m.seenAt)).today)),
  ]
  const vfulfillDataDaysAgo = ages.length === 0 ? null : Math.max(...ages)
  return {
    metaMinutesAgo,
    metaMinutesAgoByStore,
    metaYesterdayVerified,
    metaNotConnected: unseen.map(sid),
    shopifyMinutesAgo: minutes(oldestLatest(SHOPIFY_SOURCES, storeIds)),
    vfulfillImportDaysAgo: days(oldestLatest(VFULFILL_SOURCES, storeIds)),
    shipmentsThrough,
    vfulfillDataDaysAgo,
    vfulfillMissingStores: missingStores.map((m) => sid(m.storeId)),
    vfulfillOverdueOrders: overdueOrders,
    vfulfillOpenShipments: openShipments,
  }
}

/** Stores a Meta sync is expected for: those with an allowlisted ad account (a constant, not cc_stores.meta_ad_account_id). */
export const metaStoresAmong = (storeIds: string[]): string[] => metaStoreIds().filter((id) => storeIds.includes(id))

/** A Meta run's `yesterday_verified`. False for a run recorded before the field existed, or unreadable detail. */
function verifiedYesterday(detail: string | null | undefined): boolean {
  try {
    return (detail ? JSON.parse(detail) : null)?.yesterday_verified === true
  } catch {
    return false
  }
}

// ── Read ─────────────────────────────────────────────────────────────────────

/** How far back the day-level reads go: 30D + its comparison, and this month + last month, with room. */
const HISTORY_DAYS = 70
/** Newest orders read for the order list and the map. */
const RECENT_LIMIT = 60

/**
 * Cash from the vFulfill ledger (cc_vf_wallet), COD due (cc_cod_due), the latest hand-entered bank balance and
 * gateway settlements estimated from Shopify (./settlements; null when not read). Null when no source has any data.
 */
export function mapCash(
  wallet: WalletRow | null, codDue: CodDueRow[], bank: BankRow | null, now: Date, settlements: SettlementEstimate[] | null = null,
): CashPosition | null {
  const hasWallet = wallet !== null && n(wallet.transactions) > 0
  if (!hasWallet && !bank && !settlements?.length) return null
  return {
    asOf: now.toISOString(),
    bank: bank ? { amount: n(bank.amount_paise) / 100, enteredAt: bank.entered_on } : null,
    settlements: settlements?.map((s) => ({ gateway: s.gateway, storeId: sid(s.storeId), amount: s.paise / 100, orders: s.orders })) ?? null,
    // The view sums exact amounts; round once, to the paisa, as vFulfill shows it.
    vfulfillWallet: hasWallet ? Math.round(n(wallet!.balance) * 100) / 100 : 0,
    vfulfillAsOf: hasWallet ? wallet!.last_txn_date : null,
    codDue: codDue.reduce((s, r) => s + n(r.paise), 0) / 100,
    codDueOrders: codDue.reduce((s, r) => s + n(r.orders), 0),
    codDueByStore: codDue.map((r) => ({ storeId: sid(r.store_id), amount: n(r.paise) / 100, orders: n(r.orders) })),
  }
}

async function readCash(sb: Client, now: Date): Promise<CashPosition | null> {
  const one = async <T>(q: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> => {
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return data ?? []
  }
  const today = istNow(now).today
  const [wallet, codDue, bank, prepaid, stores] = await Promise.all([
    one<WalletRow>(sb.from('cc_vf_wallet').select('balance, last_txn_date, transactions')),
    one<CodDueRow>(sb.from('cc_cod_due').select('store_id, orders, paise')),
    one<BankRow>(sb.from('cc_bank_balances').select('amount_paise, entered_on').order('entered_on', { ascending: false }).order('created_at', { ascending: false }).limit(1)),
    selectAll<{ store_id: string; placed_at: string; gateways: string[] | null; total_paise: Num }>(
      () => sb.from('cc_orders').select('store_id, placed_at, gateways, total_paise').eq('payment', 'prepaid').eq('is_test', false).is('cancelled_at', null)
        .gte('placed_at', `${addDays(today, -LOOKBACK_DAYS)}T00:00:00+05:30`).order('store_id').order('order_name'),
    ),
    one<{ id: string; gateway_pct: Num }>(sb.from('cc_stores').select('id, gateway_pct')),
  ])
  const settlements = estimateSettlements(
    prepaid.map((o) => ({ storeId: o.store_id, placedAt: o.placed_at, gateways: o.gateways ?? [], totalPaise: n(o.total_paise) })),
    stores.map((s) => ({ id: s.id, gatewayPct: n(s.gateway_pct) })),
    today,
  )
  return mapCash(wallet[0] ?? null, codDue, bank[0] ?? null, now, settlements)
}

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

export type ShipmentCoverage = {
  /** Newest closed shipment across all stores, as an IST calendar date. */
  through: string | null
  /** Each store's last shipments import that included it (newest `imported_at` of its rows). A store with no rows is absent. */
  seenByStore: Record<string, string>
}

/** One-row queries: the newest closed shipment, then each store's newest imported row. */
export async function readShipmentCoverage(sb: Client, storeIds: string[]): Promise<ShipmentCoverage> {
  const [through, ...seen] = await Promise.all([
    sb.from('cc_shipments').select('closed_on').not('closed_on', 'is', null).order('closed_on', { ascending: false }).limit(1)
      .then(({ data, error }) => {
        if (error) throw new Error(error.message)
        // Date part only, should the column ever come back as a timestamp: callers compare it as YYYY-MM-DD.
        return (data?.[0]?.closed_on as string | undefined)?.slice(0, 10) ?? null
      }),
    ...storeIds.map((id) => sb.from('cc_shipments').select('imported_at').eq('store_id', id).order('imported_at', { ascending: false }).limit(1)
      .then(({ data, error }) => {
        if (error) throw new Error(error.message)
        return [id, (data?.[0]?.imported_at as string | undefined) ?? null] as const
      })),
  ])
  return { through, seenByStore: Object.fromEntries(seen.filter((s): s is readonly [string, string] => s[1] !== null)) }
}

/**
 * Per store, the IST day its shipments data runs to: the earlier of the newest closed shipment and its own last
 * import. A store missing here has never shipped through vFulfill: its unshipped orders stay "Not shipped".
 */
export function shipmentCutoffs({ through, seenByStore }: ShipmentCoverage): Record<string, string> {
  if (through === null) return {}
  return Object.fromEntries(Object.entries(seenByStore).map(([id, seenAt]) => {
    const seen = istNow(new Date(seenAt)).today
    return [id, seen < through ? seen : through]
  }))
}

/**
 * Orders from stores with vFulfill history that should be in the shipments data by now and are not: real, uncancelled,
 * placed after the newest closed shipment's day and more than SHIP_LAG_DAYS ago, with no shipment row. Null when there
 * is no closed shipment to measure from.
 */
async function readOverdueOrders(sb: Client, { through, seenByStore }: ShipmentCoverage, now: Date): Promise<number | null> {
  const stores = Object.keys(seenByStore)
  if (through === null) return null
  if (stores.length === 0) return 0
  const due = await selectAll<{ store_id: string; order_name: string }>(() => sb.from('cc_orders').select('store_id, order_name')
    .in('store_id', stores).eq('is_test', false).is('cancelled_at', null)
    .gte('placed_at', `${addDays(through, 1)}T00:00:00+05:30`).lte('placed_at', new Date(now.getTime() - SHIP_LAG_DAYS * 864e5).toISOString())
    .order('store_id').order('order_name'))
  const names = [...new Set(due.map((o) => o.order_name))]
  const shipped = new Set<string>()
  for (let i = 0; i < names.length; i += 100) {
    const part = names.slice(i, i + 100)
    const rows = await selectAll<{ store_id: string; order_name: string }>(
      () => sb.from('cc_shipments').select('store_id, order_name').in('order_name', part).order('store_id').order('order_name'))
    for (const r of rows) shipped.add(`${r.store_id}|${r.order_name}`)
  }
  return due.filter((o) => !shipped.has(`${o.store_id}|${o.order_name}`)).length
}

/** Days an open shipment counts as possibly still moving; older open rows are stuck in vFulfill (seen: 5 from May). */
const OPEN_WINDOW_DAYS = 60

/** Open shipments at stores with vFulfill history whose order was placed in the last OPEN_WINDOW_DAYS. */
async function readOpenShipments(sb: Client, { seenByStore }: ShipmentCoverage, now: Date): Promise<number> {
  const stores = Object.keys(seenByStore)
  if (stores.length === 0) return 0
  const open = await selectAll<{ store_id: string; order_name: string }>(() => sb.from('cc_shipments').select('store_id, order_name')
    .in('store_id', stores).eq('status', 'open').order('store_id').order('order_name'))
  const keys = new Set(open.map((r) => `${r.store_id}|${r.order_name}`))
  const names = [...new Set(open.map((r) => r.order_name))]
  const since = new Date(now.getTime() - OPEN_WINDOW_DAYS * 864e5).toISOString()
  let recent = 0
  for (let i = 0; i < names.length; i += 100) {
    const part = names.slice(i, i + 100)
    const rows = await selectAll<{ store_id: string; order_name: string }>(() => sb.from('cc_orders').select('store_id, order_name')
      .in('order_name', part).gte('placed_at', since).order('store_id').order('order_name'))
    recent += rows.filter((r) => keys.has(`${r.store_id}|${r.order_name}`)).length
  }
  return recent
}

/** Stores left out of the newest shipments import that have an order proving they should have been in it. */
async function readMissingStores(sb: Client, seenByStore: Record<string, string>): Promise<{ storeId: string; seenAt: string }[]> {
  const found = await Promise.all(coverageChecks(seenByStore).map(async (c) => {
    const { data, error } = await sb.from('cc_orders').select('order_name').eq('store_id', c.storeId).eq('is_test', false)
      .is('cancelled_at', null).gt('placed_at', c.seenAt).lte('placed_at', c.to).limit(1)
    if (error) throw new Error(error.message)
    return (data?.length ?? 0) > 0 ? { storeId: c.storeId, seenAt: c.seenAt } : null
  }))
  return found.filter((f) => f !== null)
}

/** Latest successful run per (source group, store), one-row queries. A null store_id run counts for every store. */
async function readSync(sb: Client, storeIds: string[], metaStoreIds: string[], now: Date): Promise<SyncStatus> {
  const groups: [string[], string[]][] = [[SHOPIFY_SOURCES, storeIds], [VFULFILL_SOURCES, storeIds], [META_SOURCES, metaStoreIds]]
  const runQueries = groups.flatMap(([sources, ids]) => ids.map(async (id) => {
    const { data, error } = await sb.from('cc_sync_runs').select('source, store_id, finished_at, ok, detail')
      .in('source', sources).eq('ok', true).or(`store_id.eq.${id},store_id.is.null`)
      .order('finished_at', { ascending: false }).limit(1)
    if (error) throw new Error(error.message)
    return (data ?? []) as SyncRunRow[]
  }))
  const coverage = readShipmentCoverage(sb, storeIds)
  const missing = coverage.then((c) => readMissingStores(sb, c.seenByStore))
  const overdue = coverage.then((c) => readOverdueOrders(sb, c, now))
  const open = coverage.then((c) => readOpenShipments(sb, c, now))
  const funds = readAdAccountFunds(sb, metaStoreIds)
  const [{ through }, missingStores, overdueOrders, openShipments, adAccountFunds, ...runs] = await Promise.all([coverage, missing, overdue, open, funds, ...runQueries])
  return { ...mapSync(runs.flat(), storeIds, now, metaStoreIds, through, missingStores, overdueOrders, openShipments), adAccountFunds }
}

/** The funds check's last read of each ad account of these stores (empty before its first run). */
async function readAdAccountFunds(sb: Client, storeIds: string[]): Promise<AdAccountFunds[]> {
  if (storeIds.length === 0) return []
  const rows = await selectAll<FundsRow>(() => sb.from('cc_ad_account_funds')
    .select('account_id, store_id, name, account_status, is_prepay, spend_cap_paise, amount_spent_paise, daily_spend_paise, today_spend_paise, active_campaigns, checked_at')
    .in('store_id', storeIds).order('account_id'))
  return rows.map(mapFundsRow)
}

/** The newest orders only, for the live map: two small reads, no history. */
export async function loadRecentOrders(): Promise<RecentOrder[]> {
  const sb = await getClient()
  const { data, error } = await sb.from('cc_orders').select('store_id, order_name, placed_at, payment, total_paise, primary_sku, city')
    .is('cancelled_at', null).eq('is_test', false).order('placed_at', { ascending: false }).limit(RECENT_LIMIT)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as OrderRow[]
  const skus = [...new Set(rows.map((r) => r.primary_sku))]
  const names = skus.length === 0 ? [] : await sb.from('cc_products').select('store_id, sku, name').in('sku', skus)
    .then(({ data: p, error: e }) => {
      if (e) throw new Error(e.message)
      return (p ?? []) as { store_id: string; sku: string; name: string }[]
    })
  const products = names.map((p) => ({ storeId: sid(p.store_id), sku: p.sku, name: p.name }))
  return rows.map((r) => mapRecentOrder(r, products))
}

export async function loadChrome(): Promise<Chrome> {
  const sb = await getClient()
  const now = new Date()
  const { stores, metaStoreIds } = await readStores(sb)
  return { now, source: 'supabase', stores, sync: await readSync(sb, stores.map((s) => s.id), metaStoreIds, now) }
}

export async function loadData(now = new Date()): Promise<Data> {
  const sb = await getClient()
  const { today, hour: nowHour, minute: nowMinute } = istNow(now)
  const yesterday = addDays(today, -1)
  const since = addDays(today, -HISTORY_DAYS)

  const orderCols = 'store_id, sku, payment, orders, units, revenue, cogs, slabs500, slabs_kg'
  const dayCols = `${orderCols}, orders_missing_cogs`
  const campCols = 'store_id, campaign_id, sku, spend, impressions, clicks, meta_purchases, attributed_orders'

  // Cash and sync start with everything else, not after it: sync waits only for the store list.
  const storesRead = readStores(sb)
  const [{ stores }, productRows, cogsRows, orders, ordersToday, ordersYesterday, campaignRows, campaignDays, campsToday, campsYesterday, resolved, recent, fixedRows, cash, sync] =
    await Promise.all([
      storesRead,
      selectAll<ProductRow>(() => sb.from('cc_products').select('store_id, sku, name, price_paise, packed_weight_grams, handle, stage, live_since').order('store_id').order('sku')),
      selectAll<CogsRow>(() => sb.from('cc_cogs_history').select('store_id, sku, cogs_paise, effective_from').order('store_id').order('sku').order('effective_from')),
      selectAll<OrderDayRow>(() => sb.from('cc_order_days').select(`date, ${dayCols}`).gte('date', since).order('date').order('store_id').order('sku').order('payment')),
      selectAll<OrderHourRow>(() => sb.from('cc_order_hours').select(`hour, ${orderCols}`).eq('date', today).order('hour').order('store_id').order('sku').order('payment')),
      selectAll<OrderHourRow>(() => sb.from('cc_order_hours').select(`hour, ${orderCols}`).eq('date', yesterday).order('hour').order('store_id').order('sku').order('payment')),
      selectAll<CampaignRow>(() => sb.from('cc_campaigns').select('campaign_id, store_id, name, landing_handle, status').order('store_id').order('campaign_id')),
      selectAll<CampaignDayRow>(() => sb.from('cc_campaign_day_rows').select(`date, ${campCols}`).gte('date', since).order('date').order('store_id').order('campaign_id').order('sku')),
      selectAll<CampaignHourRow>(() => sb.from('cc_campaign_hour_rows').select(`hour, ${campCols}`).eq('date', today).order('hour').order('store_id').order('campaign_id').order('sku')),
      selectAll<CampaignHourRow>(() => sb.from('cc_campaign_hour_rows').select(`hour, ${campCols}`).eq('date', yesterday).order('hour').order('store_id').order('campaign_id').order('sku')),
      selectAll<ResolvedRow>(() => sb.from('cc_resolved_days').select('closed_on, store_id, sku, payment, delivered, rto').order('closed_on').order('store_id').order('sku').order('payment')),
      // The newest real orders: one small read, not paged.
      sb.from('cc_orders').select('store_id, order_name, placed_at, payment, total_paise, primary_sku, city')
        .is('cancelled_at', null).eq('is_test', false).order('placed_at', { ascending: false }).limit(RECENT_LIMIT)
        .then(({ data, error }): OrderRow[] => {
          if (error) throw new Error(error.message)
          return (data ?? []) as OrderRow[]
        }),
      selectAll<{ store_id: string | null; name: string; amount_paise: Num; frequency: FixedCost['frequency']; start_date: string; end_date: string | null; gst_inclusive: boolean }>(
        () => sb.from('cc_fixed_costs').select('store_id, name, amount_paise, frequency, start_date, end_date, gst_inclusive').order('id'),
      ),
      readCash(sb, now),
      storesRead.then(({ stores: s, metaStoreIds }) => readSync(sb, s.map((x) => x.id), metaStoreIds, now)),
    ])

  const cogs = currentCogs(cogsRows, today)
  const runRatePaise = monthlyRunRate(fixedRows.map((r) => ({
    storeId: r.store_id, name: r.name, amountPaise: n(r.amount_paise), frequency: r.frequency, startDate: r.start_date, endDate: r.end_date, gstInclusive: r.gst_inclusive,
  })), today)
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
    cash, gst: null, ownerShareMonth: null,
    fixedCostsRunRate: runRatePaise === null ? null : runRatePaise / 100,
    sync,
  }
}
