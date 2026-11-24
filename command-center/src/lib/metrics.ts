/**
 * Everything the screen shows is computed here from the data contract in
 * ./types. Pure functions over the Data passed to createMetrics; no I/O.
 */
import {
  blendedBreakeven, breakeven, breaksEven, fromCpa, noBreakevenText, roasZone, SHEET_ASSUMPTIONS, type Assumptions, type Breakeven, type RoasZone,
} from './calculator'
import { addDays } from './dates'
import { fundsFresh, fundsMessage } from './meta/funds-level'
import type { Data } from './data'
import type { CampaignDay, OrderDay, PaymentType, ResolvedDay, Store, StoreId } from './types'

export type PeriodId = 'today' | '7d' | '30d' | 'month'
export const PERIODS: { id: PeriodId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7D' },
  { id: '30d', label: '30D' },
  { id: 'month', label: 'Month' },
]

export type Period = {
  id: PeriodId
  from: string
  to: string
  prevFrom: string
  prevTo: string
  /** Short label for metric captions, e.g. "7D". */
  short: string
  /** Human range, e.g. "12 – 18 Nov". */
  range: string
  prevLabel: string
}

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })

// ── Rates and unit economics, per product (store × SKU) ──────────────────────

/** Below this many orders a rate is too noisy; borrow the next level up. */
export const MIN_SAMPLE = 30
/** Pricing Master sheet defaults, used only when no store has enough history. */
const SHEET_RATES = { deliveryRate: 0.9 }

export type RateBasis = 'sku' | 'store' | 'vxp' | 'sheet'
export type Rate = {
  value: number; basis: RateBasis; n: number
  /** Null for the sheet. Lifetime covers all closed shipments for delivery rates and all snapshot orders (70 days) for COD share. */
  window: RateWindow | null
}

export type Closed = { delivered: number; rto: number }
/** One row of the delivery-rate table: a product (or the store total, sku null), per window and payment type. */
export type DeliveryRow = { sku: string | null; name: string; cells: Record<RateWindow, Record<PaymentType | 'all', Closed>> }

/** Windows over shipment close dates or order dates. The profit estimate starts with 30 days. */
export type RateWindow = '7d' | '30d' | 'lifetime'

type Keyed = { storeId: StoreId; sku: string | null }
/** Use the requested window for the SKU and store first, then fall back to lifetime history. */
function rateLevels(storeId: StoreId, sku: string, window: RateWindow) {
  const own = (r: Keyed) => r.storeId === storeId
  const levels: [RateBasis, RateWindow, (r: Keyed) => boolean][] = [
    ['sku', window, (r) => own(r) && r.sku === sku],
    ['store', window, own],
  ]
  if (window !== 'lifetime') levels.push(['store', 'lifetime', own])
  levels.push(['vxp', 'lifetime', () => true])
  return levels
}

/** COD share: the store's own count only, so `basis` is always 'store'; value null (n 0) when it has no orders yet. */
/** `orders`: the product's orders in the window, unknown payment types included (all 70 days when `n` is 0). */
export type ShareRate = Omit<Rate, 'value'> & { value: number | null; orders: number }

export type SkuEconomics = Breakeven & { codShare: ShareRate; rates: Record<PaymentType, Rate> }

type OrderRow = Omit<OrderDay, 'date'>
type SpendRow = Omit<CampaignDay, 'date'>

type Totals = {
  spend: number; impressions: number; clicks: number; metaPurchases: number
  orders: number; codOrders: number; unknownPayOrders: number; revenue: number; codRevenue: number
}
const zero = (): Totals => ({ spend: 0, impressions: 0, clicks: 0, metaPurchases: 0, orders: 0, codOrders: 0, unknownPayOrders: 0, revenue: 0, codRevenue: 0 })
function add(t: Totals, r: Totals) {
  t.spend += r.spend; t.impressions += r.impressions; t.clicks += r.clicks; t.metaPurchases += r.metaPurchases
  t.orders += r.orders; t.codOrders += r.codOrders; t.unknownPayOrders += r.unknownPayOrders; t.revenue += r.revenue; t.codRevenue += r.codRevenue
  return t
}

/** Shopify orders and Meta spend for the same stores and dates. */
type Slice = { orders: OrderRow[]; spend: SpendRow[] }

function totalsOf(s: Slice): Totals {
  const t = zero()
  for (const o of s.orders) {
    t.orders += o.orders; t.revenue += o.revenue
    if (o.payment === 'cod') { t.codOrders += o.orders; t.codRevenue += o.revenue }
    if (o.payment === 'unknown') t.unknownPayOrders += o.orders
  }
  for (const c of s.spend) { t.spend += c.spend; t.impressions += c.impressions; t.clicks += c.clicks; t.metaPurchases += c.metaPurchases }
  return t
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null)

/** A store's breakeven plus the products it was actually weighted over (never an empty list). */
export type StoreBreakeven = Breakeven & { weightedNames: string[] }

export type StoreStats = Totals & {
  store: Store
  /** Null when no product in the store has a cost on record. */
  economics: StoreBreakeven | null
  roas: number | null
  zone: RoasZone | null
  cpa: number | null
  cpm: number | null
  ctr: number | null
  /** Projected contribution: Σ profit before ads (per product × payment type, own costs) − spend. An estimate until orders resolve. */
  contribution: number
  /** Spend whose ad URL matched no product handle. Already inside `spend`. */
  unmappedSpend: number
  /** SKUs in this period's orders with no product set up in this store. Their revenue and orders count; their profit uses the store's delivery rates. */
  unknownSkus: string[]
  /** Orders in the period with a line item that had no cost on record: profit is overstated. */
  ordersMissingCogs: number
  prev: Totals & { roas: number | null; cpm: number | null; contribution: number }
}

/**
 * VXP's breakeven ROAS for a period (decided 2026-11-21): each store's product breakeven weighted by its revenue, plus
 * VXP's fixed costs. Σ revenue ÷ (Σ profit before ads at each store's breakeven economics − fixed costs). Infinity when
 * the stores' profit before ads cannot cover the fixed costs at any ROAS.
 */
export type VxpBreakeven = Pick<Breakeven, 'breakevenRoas' | 'breakevenCpa' | 'targetRoas'> & {
  /** Fixed costs falling in the period: the monthly run rate per day, today only as far as it has run. */
  fixedCosts: number
  /** False when no fixed cost is on record: the breakeven then covers ads only. */
  fixedOnRecord: boolean
  /** Stores with revenue in the period but no product cost: left out of the weighting. */
  leftOut: string[]
}

export type Portfolio = {
  stores: StoreStats[]
  total: Totals & {
    /** Before fixed costs. */
    contribution: number
    prevContribution: number; prevRevenue: number; prevSpend: number; roas: number | null
    fixedCosts: number; net: number; prevFixedCosts: number; prevNet: number; fixedOnRecord: boolean
    /** Null when no costed store has revenue in the period. */
    breakeven: VxpBreakeven | null
    zone: RoasZone | null
  }
}

export type SeriesPoint = {
  key: string
  label: string
  revenue: number
  spend: number
  profit: number
  cumRevenue: number
  cumSpend: number
  cumProfit: number
  prevCumRevenue: number | null
}

export type Call = {
  id: string
  tone: 'bad' | 'warn' | 'good'
  storeId?: StoreId
  title: string
  detail: string
}

/** Complete days before yesterday used to establish normal spend. */
const ADS_BASELINE_DAYS = 3
/** Minimum average spend per baseline day, in rupees. */
const ADS_MIN_DAILY_SPEND = 500
/** A drop fires below this share of baseline spend. */
const ADS_STOP_SPEND_SHARE = 0.1
/** Complete days of spend used to check campaign statuses. */
const ADS_STATUS_DAYS = 7
/**
 * Meta effective_status values only the user sets: a decision already made, so never a call (Needs your call lists
 * only decisions not yet made).
 */
const USER_STOPPED = new Set(['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'ARCHIVED', 'DELETED'])
/** Statuses where Meta stopped delivery: these are calls. IN_PROCESS is a transient edit, not a stop. */
const META_STOPPED = new Set(['DISAPPROVED', 'WITH_ISSUES', 'PENDING_BILLING_INFO'])

// ── Formatting (Indian digit grouping) ───────────────────────────────────────
const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
export const inr = (n: number) => `${n < 0 ? '−' : ''}₹${inrFmt.format(Math.abs(Math.round(n)))}`
export const fmtX = (n: number) => `${n.toFixed(2)}×`
export const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`

/** Every figure on screen, computed from one Data snapshot. Nothing is shared between snapshots. */
export function createMetrics(d: Data) {
  const TODAY = d.today
  const windowStart: Record<RateWindow, string> = { '7d': addDays(TODAY, -6), '30d': addDays(TODAY, -29), lifetime: '' }

  const storeById = (id: StoreId) => d.stores.find((s) => s.id === id)!

  /**
   * The products worth showing for a store in a period: those with orders or spend in it, plus any
   * product marked live. A store with a long tail of dormant catalogue items stays readable.
   */
  function relevantProducts(storeId: StoreId, p: Period) {
    const active = new Set<string>()
    for (const r of d.orders) if (r.storeId === storeId && r.date >= p.from && r.date <= p.to) active.add(r.sku)
    for (const r of d.campaignDays) if (r.storeId === storeId && r.sku !== null && r.date >= p.from && r.date <= p.to) active.add(r.sku)
    return d.products.filter((x) => x.storeId === storeId && (x.stage === 'live' || active.has(x.sku)))
  }

  /** SKUs in a store's order rows for a date range that have no product set up in that store. */
  function unknownSkusIn(storeId: StoreId, from: string, to: string): string[] {
    const known = new Set(d.products.filter((p) => p.storeId === storeId).map((p) => p.sku))
    return [...new Set(d.orders.filter((r) => r.storeId === storeId && r.date >= from && r.date <= to).map((r) => r.sku))].filter((sku) => !known.has(sku)).sort()
  }

  /** A product is (store, SKU): two stores may sell the same SKU. */
  function productOf(storeId: StoreId, sku: string) {
    const p = d.products.find((x) => x.storeId === storeId && x.sku === sku)
    if (!p) throw new Error(`No product ${sku} in ${storeId}`)
    return p
  }

  function resolvePeriod(id: PeriodId): Period {
    switch (id) {
      case 'today':
        return { id, from: TODAY, to: TODAY, prevFrom: addDays(TODAY, -1), prevTo: addDays(TODAY, -1), short: 'Today', range: `Today, ${fmtDay(TODAY)}`, prevLabel: 'yesterday by this hour' }
      case '30d':
        return { id, from: addDays(TODAY, -29), to: TODAY, prevFrom: addDays(TODAY, -59), prevTo: addDays(TODAY, -30), short: '30D', range: `${fmtDay(addDays(TODAY, -29))} – ${fmtDay(TODAY)}`, prevLabel: 'previous 30 days' }
      case 'month': {
        const from = `${TODAY.slice(0, 8)}01`
        const days = Number(TODAY.slice(8))
        const prevLast = addDays(from, -1) // last day of the previous month: the comparison never spills into this one
        const prevFrom = `${prevLast.slice(0, 8)}01`
        const prevTo = addDays(prevFrom, days - 1) > prevLast ? prevLast : addDays(prevFrom, days - 1)
        return { id, from, to: TODAY, prevFrom, prevTo, short: 'Month', range: `${fmtDay(from)} – ${fmtDay(TODAY)}`, prevLabel: 'same days last month' }
      }
      default:
        return { id: '7d', from: addDays(TODAY, -6), to: TODAY, prevFrom: addDays(TODAY, -13), prevTo: addDays(TODAY, -7), short: '7D', range: `${fmtDay(addDays(TODAY, -6))} – ${fmtDay(TODAY)}`, prevLabel: 'previous 7 days' }
    }
  }


  // ── Rates and unit economics, per product (store × SKU) ────────────────────

  /**
   * Delivered ÷ (delivered + RTO) for one product and payment type, over shipments
   * that closed in the window, with lifetime history as a fallback.
   */
  function deliveryRate(storeId: StoreId, sku: string, payment: PaymentType, window: RateWindow = '30d'): Rate {
    for (const [basis, w, match] of rateLevels(storeId, sku, window)) {
      const rs = d.resolved.filter((r) => r.payment === payment && r.closedOn >= windowStart[w] && match(r))
      const delivered = rs.reduce((s, r) => s + r.delivered, 0)
      const n = delivered + rs.reduce((s, r) => s + r.rto, 0)
      if (n >= MIN_SAMPLE) return { value: delivered / n, basis, n, window: w }
    }
    return { value: SHEET_RATES.deliveryRate, basis: 'sheet', n: 0, window: null }
  }

  /**
   * The store's own closed shipments, for reading: per product with any closed shipment (most first), then the
   * store total (`sku` null), in each window, by payment type. No fallback and no minimum sample: the count is
   * shown beside each rate. `all` includes orders whose payment type is unknown.
   */
  function deliveryTable(storeId: StoreId): DeliveryRow[] {
    const own = d.resolved.filter((r) => r.storeId === storeId && r.closedOn <= TODAY)
    const cellsFor = (rs: ResolvedDay[]): DeliveryRow['cells'] => {
      const cell = (w: RateWindow) => {
        const c = { cod: { delivered: 0, rto: 0 }, prepaid: { delivered: 0, rto: 0 }, all: { delivered: 0, rto: 0 } }
        for (const r of rs) {
          if (r.closedOn < windowStart[w]) continue
          for (const k of r.payment === 'unknown' ? (['all'] as const) : ([r.payment, 'all'] as const)) {
            c[k].delivered += r.delivered; c[k].rto += r.rto
          }
        }
        return c
      }
      return { '7d': cell('7d'), '30d': cell('30d'), lifetime: cell('lifetime') }
    }
    const closed = new Map<string, number>()
    for (const r of own) closed.set(r.sku, (closed.get(r.sku) ?? 0) + r.delivered + r.rto)
    const skus = [...closed].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([sku]) => sku)
    if (skus.length === 0) return []
    return [
      ...skus.map((sku) => ({ sku, name: d.products.find((x) => x.storeId === storeId && x.sku === sku)?.name ?? sku, cells: cellsFor(own.filter((r) => r.sku === sku)) })),
      { sku: null, name: `All ${storeById(storeId).name}`, cells: cellsFor(own) },
    ]
  }

  /**
   * COD share: always the product's own COD orders ÷ its orders with a known payment type (Vedaant, 2026-11-24): every
   * product (store, SKU) has its own share. No sheet default, no store or VXP borrowing, no minimum sample. The last 30
   * days when the product has any, else every order in the 70-day snapshot. No known-payment orders yet: value null, n 0.
   */
  function codShare(storeId: StoreId, sku: string): ShareRate {
    const count = (rs: typeof d.orders) => rs.reduce((s, r) => s + r.orders, 0)
    const own = d.orders.filter((r) => r.storeId === storeId && r.sku === sku)
    for (const w of ['30d', 'lifetime'] as const) {
      const all = own.filter((r) => w === 'lifetime' || (r.date >= windowStart[w] && r.date <= TODAY))
      const rs = all.filter((r) => r.payment !== 'unknown')
      const n = count(rs)
      if (n > 0) return { value: count(rs.filter((r) => r.payment === 'cod')) / n, basis: 'sku', n, window: w, orders: count(all) }
    }
    return { value: null, basis: 'sku', n: 0, window: null, orders: count(own) }
  }

  const assumptionsFor = (storeId: StoreId): Assumptions => ({ ...SHEET_ASSUMPTIONS, gatewayPct: storeById(storeId).gatewayPct })

  const ecoCache = new Map<string, SkuEconomics | null>()
  /**
   * Breakeven for one product: today's price, COGS and weight, the store's fees, its
   * own COD share and delivery rates. Forward-looking, so it uses today's cost. Null if the product has no cost.
   */
  function skuEconomics(storeId: StoreId, sku: string): SkuEconomics | null {
    const key = `${storeId}:${sku}`
    if (ecoCache.has(key)) return ecoCache.get(key)!
    const p = productOf(storeId, sku)
    if (p.cogs === null) { ecoCache.set(key, null); return null } // no cost on record: never guess one
    const rates = { cod: deliveryRate(storeId, sku, 'cod'), prepaid: deliveryRate(storeId, sku, 'prepaid') }
    const share = codShare(storeId, sku)
    const cogs = p.cogs
    const at = (s: number) => blendedBreakeven({ ...p, cogs }, s, { cod: rates.cod.value, prepaid: rates.prepaid.value }, assumptionsFor(storeId))
    // No orders yet, so no share: break even under the worse of all-COD and all-prepaid rather than assume a mix.
    const worse = (a: Breakeven, b: Breakeven) => (a.breakevenRoas >= b.breakevenRoas ? a : b)
    const eco = { ...(share.value !== null ? at(share.value) : { ...worse(at(1), at(0)), worstCase: true }), codShare: share, rates }
    ecoCache.set(key, eco)
    return eco
  }

  /**
   * A store's breakeven: its costed products' economics weighted by their last 30 days of orders.
   * Null when no product in the store has a cost on record.
   */
  function storeEconomics(storeId: StoreId): StoreBreakeven | null {
    const costed = d.products.filter((p) => p.storeId === storeId && p.cogs !== null).map((p) => p.sku)
    const entries = costed.map((sku) => [sku, skuEconomics(storeId, sku)] as const).filter((e): e is [string, SkuEconomics] => e[1] !== null)
    if (entries.length === 0) return null
    const recent = d.orders.filter((r) => r.storeId === storeId && r.date >= addDays(TODAY, -29))
    const w = entries.map(([sku]) => recent.filter((r) => r.sku === sku).reduce((s, r) => s + r.orders, 0))
    const wSum = w.reduce((s, x) => s + x, 0)
    // No orders in 30 days: weight the relevant costed products equally, not the whole catalogue.
    const relevant = new Set(relevantProducts(storeId, resolvePeriod('30d')).map((x) => x.sku))
    const pool = entries.some(([sku]) => relevant.has(sku)) ? entries.map(([sku]) => relevant.has(sku)) : entries.map(() => true)
    const poolSize = pool.filter(Boolean).length
    const share = (i: number) => (wSum > 0 ? w[i] / wSum : pool[i] ? 1 / poolSize : 0)
    const names = entries.filter((_, i) => share(i) > 0).map(([sku]) => productOf(storeId, sku).name)
    // Any weighted product at the worst-case mix makes the blend an assumption too.
    const worstCase = entries.some(([, e], i) => share(i) > 0 && e.worstCase === true)
    return {
      ...fromCpa(
        entries.reduce((s, [, e], i) => s + share(i) * e.avgPricePaid, 0),
        entries.reduce((s, [, e], i) => s + share(i) * e.breakevenCpa, 0),
        assumptionsFor(storeId),
      ),
      weightedNames: names,
      ...(worstCase ? { worstCase } : {}),
    }
  }

  /**
   * Expected profit before ads for a group of orders (one product, one payment type):
   * at that type's delivery rate, with the orders' own costs, i.e. every line item at
   * its order-date COGS and the whole order's shipping slabs.
   */
  function profitBeforeAds(r: OrderRow): number {
    if (r.orders === 0) return 0
    // No product lookup: an order for a SKU with no product set up still counts. Weight is irrelevant
    // because the order's own slabs are passed.
    const a = assumptionsFor(r.storeId)
    const pricePaid = r.revenue / r.orders
    const perOrderAs = (pay: PaymentType) => breakeven({
      // The calculator takes the COD list price; for prepaid, undo the prepaid discount to get it back.
      price: pay === 'cod' ? pricePaid : (pricePaid + a.prepaidFlat) / (1 - a.prepaidPct),
      cogs: r.cogs / r.orders,
      packedWeightGrams: 0,
      slabs500: r.slabs500 / r.orders,
      slabsKg: r.slabsKg / r.orders,
      deliveryRate: deliveryRate(r.storeId, r.sku, pay).value,
      codShare: pay === 'cod' ? 1 : 0,
    }, a).breakevenCpa
    if (r.payment !== 'unknown') return r.orders * perOrderAs(r.payment)
    // Payment never recorded: expect the product's own COD/prepaid mix rather than pick one.
    const share = codShare(r.storeId, r.sku).value
    // No order with a known payment yet: expect the worse of the two.
    if (share === null) return r.orders * Math.min(perOrderAs('cod'), perOrderAs('prepaid'))
    return r.orders * (share * perOrderAs('cod') + (1 - share) * perOrderAs('prepaid'))
  }

  /** The weakest delivery-rate source per store with SKUs to check. */
  function rateSources(storeIds: StoreId[] = d.stores.map((s) => s.id), period?: Period) {
    const sources = ['own-30d', 'own-lifetime', 'vxp', 'sheet'] as const
    // Rates are checked directly, so products without a cost and SKUs with no product (orders still use their rates) count too.
    return storeIds.flatMap((id) => {
      const skus = period
        ? [...relevantProducts(id, period).map((p) => p.sku), ...unknownSkusIn(id, period.from, period.to)]
        : d.products.filter((p) => p.storeId === id).map((p) => p.sku)
      if (skus.length === 0) return []
      let weakest = 0
      for (const sku of skus) {
        for (const pay of ['cod', 'prepaid'] as const) {
          const { basis, window } = deliveryRate(id, sku, pay)
          const source = basis === 'vxp' || basis === 'sheet' ? basis : window === 'lifetime' ? 'own-lifetime' : 'own-30d'
          weakest = Math.max(weakest, sources.indexOf(source))
        }
      }
      return [{ store: storeById(id), source: sources[weakest] }]
    })
  }

  /** Stores whose profit estimate borrows delivery rates from VXP or the sheet. */
  function borrowedRates(storeIds?: StoreId[], period?: Period): Store[] {
    return rateSources(storeIds, period).filter(({ source }) => source === 'vxp' || source === 'sheet').map(({ store }) => store)
  }

  // ── Aggregation ────────────────────────────────────────────────────────────

  const contributionOf = (s: Slice) =>
    s.orders.reduce((sum, o) => sum + profitBeforeAds(o), 0) - s.spend.reduce((sum, c) => sum + c.spend, 0)

  const sliceIn = (storeIds: StoreId[], from: string, to: string): Slice => ({
    orders: d.orders.filter((r) => storeIds.includes(r.storeId) && r.date >= from && r.date <= to),
    spend: d.campaignDays.filter((r) => storeIds.includes(r.storeId) && r.date >= from && r.date <= to),
  })

  /**
   * Share of a yesterday hour that has "happened" by now: hours before the current one in full,
   * the current hour in proportion to the minutes elapsed, later hours not at all.
   */
  const elapsed = (hour: number) => (hour < d.nowHour ? 1 : hour === d.nowHour ? d.nowMinute / 60 : 0)
  const scaleOrder = <T extends OrderRow>(r: T, k: number): T =>
    k === 1 ? r : { ...r, orders: r.orders * k, units: r.units * k, revenue: r.revenue * k, cogs: r.cogs * k, slabs500: r.slabs500 * k, slabsKg: r.slabsKg * k }
  const scaleSpend = <T extends SpendRow>(r: T, k: number): T =>
    k === 1 ? r : { ...r, spend: r.spend * k, impressions: r.impressions * k, clicks: r.clicks * k, metaPurchases: r.metaPurchases * k, attributedOrders: r.attributedOrders * k }

  /** For "today" the previous period is yesterday up to now: earlier hours whole, the current hour pro rata. */
  function prevSlice(storeIds: StoreId[], p: Period): Slice {
    if (p.id !== 'today') return sliceIn(storeIds, p.prevFrom, p.prevTo)
    return {
      orders: d.orderHoursYesterday.filter((r) => storeIds.includes(r.storeId) && elapsed(r.hour) > 0).map((r) => scaleOrder(r, elapsed(r.hour))),
      spend: d.campaignHoursYesterday.filter((r) => storeIds.includes(r.storeId) && elapsed(r.hour) > 0).map((r) => scaleSpend(r, elapsed(r.hour))),
    }
  }

  function storeStats(storeId: StoreId, p: Period): StoreStats {
    const store = storeById(storeId)
    const economics = storeEconomics(storeId)
    const slice = sliceIn([storeId], p.from, p.to)
    const t = totalsOf(slice)
    const prev = prevSlice([storeId], p)
    const pt = totalsOf(prev)
    const roas = ratio(t.revenue, t.spend)
    return {
      ...t, store, economics, roas,
      zone: roas === null || economics === null ? null : roasZone(roas, economics),
      cpa: ratio(t.spend, t.orders),
      cpm: t.impressions > 0 ? (t.spend / t.impressions) * 1000 : null,
      ctr: ratio(t.clicks, t.impressions),
      contribution: contributionOf(slice),
      unmappedSpend: slice.spend.filter((r) => r.sku === null).reduce((sum, r) => sum + r.spend, 0),
      unknownSkus: [...new Set(slice.orders.map((r) => r.sku))].filter((sku) => !d.products.some((x) => x.storeId === storeId && x.sku === sku)).sort(),
      ordersMissingCogs: slice.orders.reduce((sum, r) => sum + (r.ordersMissingCogs ?? 0), 0),
      prev: {
        ...pt,
        roas: ratio(pt.revenue, pt.spend),
        cpm: pt.impressions > 0 ? (pt.spend / pt.impressions) * 1000 : null,
        contribution: contributionOf(prev),
      },
    }
  }

  function portfolio(p: Period, storeIds: StoreId[] = d.stores.map((s) => s.id)): Portfolio {
    const stores = storeIds.map((id) => storeStats(id, p)).sort((a, b) => b.contribution - a.contribution)
    const total = stores.reduce((t, s) => add(t, s), zero())
    const roas = ratio(total.revenue, total.spend)
    const contribution = stores.reduce((s, x) => s + x.contribution, 0)
    const prevContribution = stores.reduce((s, x) => s + x.prev.contribution, 0)
    const fixedCosts = fixedCostsIn(p.from, p.to, TODAY)
    const prevFixedCosts = fixedCostsIn(p.prevFrom, p.prevTo, p.id === 'today' ? p.prevTo : null)
    const fixedOnRecord = d.fixedCostsRunRate !== null
    const breakeven = vxpBreakeven(stores, fixedCosts)
    return {
      stores,
      total: {
        ...total,
        contribution, prevContribution, fixedCosts, prevFixedCosts, fixedOnRecord,
        net: contribution - fixedCosts,
        prevNet: prevContribution - prevFixedCosts,
        prevRevenue: stores.reduce((s, x) => s + x.prev.revenue, 0),
        prevSpend: stores.reduce((s, x) => s + x.prev.spend, 0),
        roas, breakeven,
        // A store with sales but no cost is in the blended ROAS but not the breakeven: no zone rather than a false one.
        zone: roas === null || breakeven === null || breakeven.leftOut.length > 0 ? null : roasZone(roas, breakeven),
      },
    }
  }

  /** Fixed costs falling in the range, with the partial day counted only up to the current time. */
  function fixedCostsIn(from: string, to: string, partialDay: string | null): number {
    if (!d.fixedCostsRunRate) return 0
    let days = 0
    for (let day = from; day <= to; day = addDays(day, 1)) days += day === partialDay ? (d.nowHour + d.nowMinute / 60) / 24 : 1
    return ((d.fixedCostsRunRate * 12) / 365) * days
  }

  function vxpBreakeven(stores: StoreStats[], fixedCosts: number): VxpBreakeven | null {
    const costed = stores.filter((s) => s.economics !== null && s.revenue > 0)
    const revenue = costed.reduce((t, s) => t + s.revenue, 0)
    if (revenue === 0) return null
    // A store's revenue ÷ its breakeven ROAS, written via its CPA so a store losing money before ads subtracts instead of counting 0.
    const beforeAds = costed.reduce((t, s) => t + (s.revenue / s.economics!.avgPricePaid) * s.economics!.breakevenCpa, 0)
    const { breakevenRoas, breakevenCpa, targetRoas } = fromCpa(revenue, beforeAds - fixedCosts)
    return {
      breakevenRoas, breakevenCpa, targetRoas, fixedCosts,
      fixedOnRecord: d.fixedCostsRunRate !== null,
      leftOut: stores.filter((s) => s.economics === null && s.revenue > 0).map((s) => s.store.name),
    }
  }

  /** Buckets for the pace chart: hours for Today, days otherwise. */
  function series(storeIds: StoreId[], p: Period): SeriesPoint[] {
    const bucket = (s: Slice) => {
      const t = totalsOf(s)
      return { revenue: t.revenue, spend: t.spend, profit: contributionOf(s) }
    }

    let buckets: { key: string; label: string; revenue: number; spend: number; profit: number }[]
    let prev: number[]
    if (p.id === 'today') {
      const inStores = <T extends { storeId: StoreId }>(rows: T[]) => rows.filter((r) => storeIds.includes(r.storeId))
      const orders = inStores(d.orderHours)
      const spend = inStores(d.campaignHours)
      const hours = [...new Set([...orders, ...spend].map((h) => h.hour))].sort((a, b) => a - b)
      buckets = hours.map((hour) => ({
        key: String(hour),
        label: new Date(Date.UTC(2026, 0, 1, hour)).toLocaleTimeString('en-IN', { hour: 'numeric', hour12: true, timeZone: 'UTC' }),
        ...bucket({ orders: orders.filter((h) => h.hour === hour), spend: spend.filter((h) => h.hour === hour) }),
      }))
      const yesterday = inStores(d.orderHoursYesterday)
      prev = buckets.map((b) => yesterday.filter((h) => h.hour <= Number(b.key)).reduce((s, h) => s + h.revenue * elapsed(h.hour), 0))
    } else {
      const days: string[] = []
      for (let day = p.from; day <= p.to; day = addDays(day, 1)) days.push(day)
      buckets = days.map((day) => ({ key: day, label: fmtDay(day), ...bucket(sliceIn(storeIds, day, day)) }))
      // Capped at prevTo: after a shorter month the comparison must not run on into the current one.
      prev = days.map((_, i) => {
        const end = addDays(p.prevFrom, i)
        return totalsOf(sliceIn(storeIds, p.prevFrom, end > p.prevTo ? p.prevTo : end)).revenue
      })
    }
    let cr = 0, cs = 0, cp = 0
    return buckets.map((b, i) => {
      cr += b.revenue; cs += b.spend; cp += b.profit
      return { ...b, cumRevenue: cr, cumSpend: cs, cumProfit: cp, prevCumRevenue: prev[i] ?? null }
    })
  }

  /**
   * One store's ads state for "ads stopped" and the user-paused check. `stopped`: the call's detail when Meta stopped
   * delivery or a verified drop hit campaigns still live; null otherwise (a user pause is never a stop).
   */
  function adsState(id: StoreId) {
    const yesterday = addDays(TODAY, -1)
    const weekStart = addDays(TODAY, -ADS_STATUS_DAYS)
    const baselineStart = addDays(yesterday, -ADS_BASELINE_DAYS)
    const week = d.campaignDays.filter((r) => r.storeId === id && r.date >= weekStart && r.date <= yesterday)
    const yesterdaySpend = week.filter((r) => r.date === yesterday).reduce((s, r) => s + r.spend, 0)
    // Yesterday's spend is only complete once this store's Meta sync has run since IST midnight (the cron runs at 06:00):
    // before that, or when its sync is failing, a low "yesterday" is missing data, not stopped ads.
    const metaAge = d.sync.metaMinutesAgoByStore[id]
    // ...and only when that sync matched yesterday's campaign spend to the account total (a partial answer is not a stop).
    const metaHasYesterday = metaAge !== undefined && metaAge <= d.nowHour * 60 + d.nowMinute && d.sync.metaYesterdayVerified[id] === true
    const statusOf = (campaignId: string) => d.campaigns.find((c) => c.storeId === id && c.id === campaignId)?.status ?? null
    const userStopped = (campaignId: string) => USER_STOPPED.has(statusOf(campaignId) ?? '')
    const metaStopped = (campaignId: string) => META_STOPPED.has(statusOf(campaignId) ?? '')
    // Campaigns the user paused are left out of the drop: his pause is not a call. A drop in what is still live is.
    const live = week.filter((r) => !userStopped(r.campaignId))
    const liveYesterday = live.filter((r) => r.date === yesterday).reduce((s, r) => s + r.spend, 0)
    const liveDaily = live.filter((r) => r.date >= baselineStart && r.date < yesterday).reduce((s, r) => s + r.spend, 0) / ADS_BASELINE_DAYS
    // Spend synced for today from a delivering campaign means ads are running again (a replacement, or a resume).
    // A stopped campaign's spend does not count: a paused one can still bill a trickle (Kaiven: ₹28 after its pause).
    const spendingToday = d.campaignDays.some((r) => r.storeId === id && r.date === TODAY && r.spend > 0 && !userStopped(r.campaignId) && !metaStopped(r.campaignId))
    const spendDropped = metaHasYesterday && liveDaily >= ADS_MIN_DAILY_SPEND && liveYesterday < liveDaily * ADS_STOP_SPEND_SHARE
    const spendingCampaigns = [...new Set(week.filter((r) => r.spend > 0).map((r) => r.campaignId))]
    // A live campaign that has not spent yet (a replacement just launched) means delivery has not stopped.
    const anyActive = d.campaigns.some((c) => c.storeId === id && c.status === 'ACTIVE')
    const blocked = spendingCampaigns.filter(metaStopped)
    const metaBlocked = blocked.length > 0 && !anyActive && spendingCampaigns.every((c) => metaStopped(c) || userStopped(c))
    const why = [...new Set(blocked.map((c) => statusOf(c)!))].join(', ')
    const stopped = !spendingToday && (spendDropped || metaBlocked)
      ? [
        spendDropped ? `${inr(liveYesterday)} yesterday vs ${inr(liveDaily)}/day before` : null,
        metaBlocked ? `Meta stopped ${blocked.length === 1 ? 'the campaign' : `${blocked.length} campaigns`} (${why})` : null,
      ].filter(Boolean).join(' · ')
      : null
    return { stopped, userStopped, anyActive, yesterdaySpend, weekStart, week }
  }

  /** The funds check's reads that are recent enough to show (see FUNDS_STALE_HOURS). */
  const freshFunds = () => d.sync.adAccountFunds.filter((a) => fundsFresh(a.checkedAt, d.now))

  /**
   * Meta stopped the store's ads for funds: a watched account is out, and no other account of the store could still be
   * delivering (one that is not out with an ACTIVE campaign). Its campaigns can still read ACTIVE (Oorvia-1, 2026-11-24).
   * Every account of the store needs a fresh read: a stale backup account may be the one still delivering.
   */
  function fundsStopped(id: StoreId): boolean {
    const own = d.sync.adAccountFunds.filter((a) => a.storeId === id)
    if (!own.every((a) => fundsFresh(a.checkedAt, d.now))) return false
    return own.some((a) => a.watched && a.level === 'out') && !own.some((a) => a.level !== 'out' && a.active)
  }

  /** Stores whose ads stopped (the `${id}-ads-stopped` rule, or out of funds), without the three-call cap of `calls()`. */
  function adsStopped(storeIds: StoreId[] = d.stores.map((s) => s.id)): StoreId[] {
    return storeIds.filter((id) => adsState(id).stopped !== null || fundsStopped(id))
  }

  /** "Needs your call": facts only, at most three, worst first. Empty is a valid answer. */
  function calls(p: Period, storeIds: StoreId[] = d.stores.map((s) => s.id)): Call[] {
    const out: Call[] = []
    const yesterday = addDays(TODAY, -1)
    for (const id of storeIds) {
      const store = storeById(id)
      const eco = storeEconomics(id)
      const { stopped, userStopped, anyActive, yesterdaySpend, weekStart, week } = adsState(id)
      if (stopped !== null) out.push({ id: `${id}-ads-stopped`, tone: 'warn', storeId: id, title: `${store.name} ads stopped`, detail: stopped })
      // Every campaign that spent in the period (or the last week) is user-paused and nothing was spent yesterday: he
      // stopped the ads himself, so the store's loss is no longer a decision to make. It still shows on the store row.
      const pausedFrom = p.from < weekStart ? p.from : weekStart
      const periodSpenders = [...new Set(d.campaignDays.filter((r) => r.storeId === id && r.date >= pausedFrom && r.spend > 0).map((r) => r.campaignId))]
      const userPausedAds = periodSpenders.length > 0 && periodSpenders.every(userStopped) && yesterdaySpend === 0 && !anyActive
      const last3Start = addDays(TODAY, -3)
      const last3 = sliceIn([id], last3Start, yesterday)
      // Combined, not day by day: at 2–3 orders a day a single day's ROAS is mostly noise.
      const t = totalsOf(last3)
      const daysWithSpend = new Set(week.filter((r) => r.date >= last3Start).map((r) => r.date)).size
      if (!userPausedAds && eco && daysWithSpend === 3 && t.spend > 0 && t.revenue / t.spend < eco.breakevenRoas) {
        out.push({
          id: `${id}-below`, tone: 'bad', storeId: id,
          title: breaksEven(eco) ? `${store.name} below breakeven over the last 3 days` : `${store.name} ${eco.worstCase ? 'may lose' : 'loses'} money on every order, before ads`,
          detail: breaksEven(eco)
            ? `ROAS ${fmtX(t.revenue / t.spend)} vs ${fmtX(eco.breakevenRoas)} breakeven · ${t.orders} orders · ${inr(t.spend)} spent`
            : `${noBreakevenText(eco)} · ROAS ${fmtX(t.revenue / t.spend)} · ${inr(t.spend)} spent`,
        })
      }
      const s = storeStats(id, p)
      // The call chip follows the product breakeven, so it can say Hold in a week that lost money: this keeps the loss
      // from reading as "nothing needs you". One bad line per store: the 3-day rule above already names it.
      if (!userPausedAds && s.contribution < 0 && !out.some((c) => c.id === `${id}-below`)) {
        out.push({
          id: `${id}-loss`, tone: 'bad', storeId: id,
          title: `${store.name} is losing money`,
          detail: [
            `Profit (est.) −${inr(-s.contribution)} ${p.id === 'today' ? 'today' : `over ${p.short}`}`,
            s.roas !== null && eco && breaksEven(eco) ? `ROAS ${fmtX(s.roas)} vs ${fmtX(eco.breakevenRoas)} breakeven` : null,
            s.spend > 0 ? `${inr(s.spend)} spent` : null,
          ].filter(Boolean).join(' · '),
        })
      }
      if (s.zone === 'profit' && s.orders >= 10) {
        out.push({
          id: `${id}-target`, tone: 'good', storeId: id,
          title: `${store.name} above your target`,
          detail: `ROAS ${fmtX(s.roas!)} vs ${fmtX(eco!.targetRoas)} target · ${s.orders} orders`,
        })
      }
      if (s.cpm && s.prev.cpm && s.cpm / s.prev.cpm > 1.2) {
        out.push({
          id: `${id}-cpm`, tone: 'warn', storeId: id,
          title: `${store.name} CPM up ${Math.round((s.cpm / s.prev.cpm - 1) * 100)}%`,
          detail: `${inr(s.cpm)} vs ${inr(s.prev.cpm)} the ${p.prevLabel}`,
        })
      }
    }
    const { vfulfillImportDaysAgo: importAge, vfulfillDataDaysAgo: dataAge, shipmentsThrough, vfulfillMissingStores: missing, vfulfillOverdueOrders: overdue, vfulfillOpenShipments: open } = d.sync
    // Current: no order waiting on vFulfill and no recent shipment still open (it may have closed since the export).
    const dataOlder = dataAge !== null && (importAge === null || dataAge > importAge)
    const vf = dataOlder ? dataAge : importAge
    if (missing.length > 0) {
      // A store left unticked in vFulfill's export: named whatever the age, since the next import repeats it.
      const names = missing.map((id) => d.stores.find((s) => s.id === id)?.name ?? id)
      out.push({
        id: 'vf-stale', tone: 'warn',
        title: `${names.join(' and ')} not in the last vFulfill import`,
        detail: `Tick every store in vFulfill's shipments export · ${missing.length > 1 ? 'their' : 'its'} delivery rates and Resolved figures are out of date`,
      })
    } else if (!(overdue === 0 && (open ?? 0) === 0) && (vf === null || vf > 3)) {
      out.push({
        id: 'vf-stale', tone: 'warn',
        title: vf === null ? 'vFulfill never imported' : `vFulfill ${dataOlder ? 'shipments data' : 'import'} is ${vf} days old`,
        detail: dataOlder
          ? `${shipmentsThrough ? `Newest closed shipment ${fmtDay(shipmentsThrough)} · ` : ''}delivery rates and Resolved figures may be out of date`
          : 'Delivery rates may be out of date',
      })
    }
    // Ad account funds (the 2-hourly check): the same rule and words as the phone push. One per store and level, worst first.
    // A stale read is dropped rather than shown as current: the check has stopped, and the balance may have changed.
    const funds = freshFunds()
      .filter((a) => storeIds.includes(a.storeId) && a.watched && a.level !== 'ok')
      .sort((x, y) => (x.level === y.level ? (x.runwayDays ?? 0) - (y.runwayDays ?? 0) : x.level === 'out' ? -1 : 1))
    for (const a of funds) {
      const id = `${a.storeId}-funds-${a.level}`
      if (out.some((c) => c.id === id)) continue
      const { title, body } = fundsMessage(a, a.level)
      out.push({ id, tone: a.level === 'out' ? 'bad' : 'warn', storeId: a.storeId, title, detail: body })
    }
    const c = cash()
    // Without a bank balance the total is a fraction of the cash: no alarm on it.
    if (c && c.bank && c.coversDays !== null && c.coversDays < 10) {
      out.push({ id: 'cash', tone: 'bad', title: `Cash covers ${Math.floor(c.coversDays)} days of spend`, detail: `${inr(c.total)} across ${c.included.join(', ')}` })
    }
    // Out of funds leads: Meta has stopped delivery now, which outranks what past spend returned.
    const rank = (c: Call) => (c.id.endsWith('-funds-out') ? -1 : { bad: 0, warn: 1, good: 2 }[c.tone])
    return out.sort((a, b) => rank(a) - rank(b)).slice(0, 3)
  }

  /**
   * Cash on hand: bank + gateway settlements due + vFulfill wallet + COD due. Parts not connected yet are left out
   * of the total and named in `missing`, so a partial figure always says it is partial. Null until any source is wired.
   */
  function cash() {
    if (!d.cash) return null
    const settlements = d.cash.settlements?.reduce((s, x) => s + x.amount, 0) ?? 0
    const total = (d.cash.bank?.amount ?? 0) + settlements + d.cash.vfulfillWallet + d.cash.codDue
    const included = [...(d.cash.bank ? ['bank'] : []), ...(d.cash.settlements ? ['gateways'] : []), 'vFulfill wallet', 'COD due']
    const missing = [...(d.cash.bank ? [] : ['bank']), ...(d.cash.settlements ? [] : ['gateway settlements'])]
    const weekSpend = d.campaignDays.filter((r) => r.date >= addDays(TODAY, -7) && r.date <= addDays(TODAY, -1)).reduce((s, r) => s + r.spend, 0)
    const dailySpend = weekSpend / 7
    return { ...d.cash, settlementsTotal: settlements, total, included, missing, dailySpend, coversDays: dailySpend > 0 ? total / dailySpend : null }
  }

  function gst() {
    if (!d.gst) return null
    return { ...d.gst, owed: d.gst.cash }
  }

  /** Monthly P&L net and owner share, as shown on Money. */
  function ownerShare() {
    const month = d.ownerShareMonth
    return month === null || month.share === null ? null : { net: month.net, share: month.share }
  }

  const sync = () => d.sync

  /**
   * Each campaign's own Meta spend and the Shopify orders carrying its campaign ID.
   * Orders without a campaign ID (organic, or lost at checkout) belong to no campaign.
   */
  function campaigns(storeId: StoreId, p: Period) {
    const rows = d.campaignDays.filter((r) => r.storeId === storeId && r.date >= p.from && r.date <= p.to)
    return d.campaigns.filter((c) => c.storeId === storeId).map((c) => {
      const own = rows.filter((r) => r.campaignId === c.id)
      const spend = own.reduce((s, r) => s + r.spend, 0)
      const orders = own.reduce((s, r) => s + r.attributedOrders, 0)
      const cpa = ratio(spend, orders)
      const beCpa = c.sku ? skuEconomics(storeId, c.sku)?.breakevenCpa ?? null : null
      return {
        ...c, spend, orders, cpa,
        // A product that loses money before ads is over breakeven at any CPA.
        vsBreakeven: cpa === null || beCpa === null ? null : beCpa > 0 ? cpa / beCpa : Infinity,
        /** Zero orders but spent more than one order's breakeven CPA: a total loss, not a missing number. */
        noSalesLoss: orders === 0 && beCpa !== null && spend > beCpa,
      }
    }).filter((c) => c.spend > 0)
  }

  function recentOrders(storeIds: StoreId[], limit: number) {
    return d.recentOrders.filter((o) => storeIds.includes(o.storeId)).slice(0, limit)
  }

  /** Shipments vFulfill closed in the period (by close date), whatever day they were ordered. Counts only, no money. */
  function resolvedCounts(storeIds: StoreId[], p: Period) {
    const rows = d.resolved.filter((r) => storeIds.includes(r.storeId) && r.closedOn >= p.from && r.closedOn <= p.to)
    const delivered = rows.reduce((s, r) => s + r.delivered, 0)
    const rto = rows.reduce((s, r) => s + r.rto, 0)
    return { delivered, rto, rate: delivered + rto > 0 ? delivered / (delivered + rto) : null }
  }

  const minutesAgo = (iso: string) => Math.max(0, Math.round((d.now.getTime() - Date.parse(iso)) / 60000))

  return {
    resolvePeriod, deliveryRate, deliveryTable, codShare, skuEconomics, storeEconomics, profitBeforeAds, borrowedRates, rateSources, storeStats, portfolio,
    series, calls, adsStopped, cash, gst, ownerShare, sync, campaigns, recentOrders, resolvedCounts, minutesAgo, relevantProducts,
    products: d.products, stores: d.stores, storeById, productOf,
    /** True when the store has never had a successful Meta sync, so "no ads" would really mean "no data". */
    metaNotConnected: (id: StoreId) => d.sync.metaNotConnected.includes(id),
  }
}

export type Metrics = ReturnType<typeof createMetrics>
