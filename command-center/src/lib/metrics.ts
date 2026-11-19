/**
 * Everything the screen shows is computed here from the data contract in
 * ./types. Pure functions over the Data passed to createMetrics; no I/O.
 */
import {
  blendedBreakeven, breakeven, breaksEven, fromCpa, noBreakevenText, roasZone, SHEET_ASSUMPTIONS, type Assumptions, type Breakeven, type RoasZone,
} from './calculator'
import { addDays } from './dates'
import type { Data } from './data'
import type { CampaignDay, OrderDay, PaymentType, Store, StoreId } from './types'

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
const SHEET_RATES = { deliveryRate: 0.9, codShare: 0.7 }

export type RateBasis = 'sku' | 'store' | 'vxp' | 'sheet'
export type Rate = { value: number; basis: RateBasis; n: number }

type Keyed = { storeId: StoreId; sku: string | null }
/** A product is (store, SKU): the same SKU in two stores never shares a rate at the SKU level. */
const levels = (storeId: StoreId, sku: string): [RateBasis, (r: Keyed) => boolean][] => [
  ['sku', (r) => r.storeId === storeId && r.sku === sku],
  ['store', (r) => r.storeId === storeId],
  ['vxp', () => true],
]

/** Windows over shipment close dates. The profit estimate uses 30 days. */
export type RateWindow = '7d' | '30d' | 'lifetime'

export type SkuEconomics = Breakeven & { codShare: Rate; rates: Record<PaymentType, Rate> }

type OrderRow = Omit<OrderDay, 'date'>
type SpendRow = Omit<CampaignDay, 'date'>

type Totals = {
  spend: number; impressions: number; clicks: number; metaPurchases: number
  orders: number; codOrders: number; revenue: number; codRevenue: number
}
const zero = (): Totals => ({ spend: 0, impressions: 0, clicks: 0, metaPurchases: 0, orders: 0, codOrders: 0, revenue: 0, codRevenue: 0 })
function add(t: Totals, r: Totals) {
  t.spend += r.spend; t.impressions += r.impressions; t.clicks += r.clicks; t.metaPurchases += r.metaPurchases
  t.orders += r.orders; t.codOrders += r.codOrders; t.revenue += r.revenue; t.codRevenue += r.codRevenue
  return t
}

/** Shopify orders and Meta spend for the same stores and dates. */
type Slice = { orders: OrderRow[]; spend: SpendRow[] }

function totalsOf(s: Slice): Totals {
  const t = zero()
  for (const o of s.orders) {
    t.orders += o.orders; t.revenue += o.revenue
    if (o.payment === 'cod') { t.codOrders += o.orders; t.codRevenue += o.revenue }
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

export type Portfolio = {
  stores: StoreStats[]
  total: Totals & { contribution: number; prevContribution: number; prevRevenue: number; prevSpend: number; roas: number | null }
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
   * that closed in the window. Falls back product → store → VXP within that window alone.
   */
  function deliveryRate(storeId: StoreId, sku: string, payment: PaymentType, window: RateWindow = '30d'): Rate {
    const inWindow = d.resolved.filter((r) => r.payment === payment && r.closedOn >= windowStart[window])
    for (const [basis, match] of levels(storeId, sku)) {
      const rs = inWindow.filter(match)
      const delivered = rs.reduce((s, r) => s + r.delivered, 0)
      const n = delivered + rs.reduce((s, r) => s + r.rto, 0)
      if (n >= MIN_SAMPLE) return { value: delivered / n, basis, n }
    }
    return { value: SHEET_RATES.deliveryRate, basis: 'sheet', n: 0 }
  }

  /** COD share of orders placed, trailing 30 days. Falls back product → store → VXP. */
  function codShare(storeId: StoreId, sku: string): Rate {
    const recent = d.orders.filter((r) => r.date >= addDays(TODAY, -29) && r.date <= TODAY)
    for (const [basis, match] of levels(storeId, sku)) {
      const rs = recent.filter(match)
      const n = rs.reduce((s, r) => s + r.orders, 0)
      if (n >= MIN_SAMPLE) return { value: rs.filter((r) => r.payment === 'cod').reduce((s, r) => s + r.orders, 0) / n, basis, n }
    }
    return { value: SHEET_RATES.codShare, basis: 'sheet', n: 0 }
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
    const eco = {
      ...blendedBreakeven({ ...p, cogs: p.cogs }, share.value, { cod: rates.cod.value, prepaid: rates.prepaid.value }, assumptionsFor(storeId)),
      codShare: share, rates,
    }
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
    return {
      ...fromCpa(
        entries.reduce((s, [, e], i) => s + share(i) * e.avgPricePaid, 0),
        entries.reduce((s, [, e], i) => s + share(i) * e.breakevenCpa, 0),
        assumptionsFor(storeId),
      ),
      weightedNames: names,
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
    // The calculator takes the COD list price; for prepaid, undo the prepaid discount to get it back.
    const listPrice = r.payment === 'cod' ? pricePaid : (pricePaid + a.prepaidFlat) / (1 - a.prepaidPct)
    const perOrder = breakeven({
      price: listPrice,
      cogs: r.cogs / r.orders,
      packedWeightGrams: 0,
      slabs500: r.slabs500 / r.orders,
      slabsKg: r.slabsKg / r.orders,
      deliveryRate: deliveryRate(r.storeId, r.sku, r.payment).value,
      codShare: r.payment === 'cod' ? 1 : 0,
    }, a).breakevenCpa
    return r.orders * perOrder
  }

  /** Stores whose profit estimate borrows delivery rates from VXP or the sheet. */
  function borrowedRates(storeIds: StoreId[] = d.stores.map((s) => s.id), period?: Period): Store[] {
    const borrows = (id: StoreId, sku: string) =>
      (['cod', 'prepaid'] as const).some((pay) => {
        const basis = deliveryRate(id, sku, pay).basis
        return basis === 'vxp' || basis === 'sheet'
      })
    // Rates are checked directly, so products without a cost and SKUs with no product (orders still use their rates) count too.
    return storeIds.filter((id) => {
      const skus = period
        ? [...relevantProducts(id, period).map((p) => p.sku), ...unknownSkusIn(id, period.from, period.to)]
        : d.products.filter((p) => p.storeId === id).map((p) => p.sku)
      return skus.some((sku) => borrows(id, sku))
    }).map(storeById)
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
    return {
      stores,
      total: {
        ...total,
        contribution: stores.reduce((s, x) => s + x.contribution, 0),
        prevContribution: stores.reduce((s, x) => s + x.prev.contribution, 0),
        prevRevenue: stores.reduce((s, x) => s + x.prev.revenue, 0),
        prevSpend: stores.reduce((s, x) => s + x.prev.spend, 0),
        roas: ratio(total.revenue, total.spend),
      },
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

  /** "Needs your call": facts only, at most three, worst first. Empty is a valid answer. */
  function calls(p: Period, storeIds: StoreId[] = d.stores.map((s) => s.id)): Call[] {
    const out: Call[] = []
    for (const id of storeIds) {
      const store = storeById(id)
      const eco = storeEconomics(id)
      const last3 = sliceIn([id], addDays(TODAY, -3), addDays(TODAY, -1))
      // Combined, not day by day: at 2–3 orders a day a single day's ROAS is mostly noise.
      const t = totalsOf(last3)
      const daysWithSpend = new Set(d.campaignDays.filter((r) => r.storeId === id && r.date >= addDays(TODAY, -3) && r.date <= addDays(TODAY, -1)).map((r) => r.date)).size
      if (eco && daysWithSpend === 3 && t.spend > 0 && t.revenue / t.spend < eco.breakevenRoas) {
        out.push({
          id: `${id}-below`, tone: 'bad', storeId: id,
          title: breaksEven(eco) ? `${store.name} below breakeven over the last 3 days` : `${store.name} loses money on every order, before ads`,
          detail: breaksEven(eco)
            ? `ROAS ${fmtX(t.revenue / t.spend)} vs ${fmtX(eco.breakevenRoas)} breakeven · ${t.orders} orders · ${inr(t.spend)} spent`
            : `${noBreakevenText(eco)} · ROAS ${fmtX(t.revenue / t.spend)} · ${inr(t.spend)} spent`,
        })
      }
      const s = storeStats(id, p)
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
    const vf = d.sync.vfulfillImportDaysAgo
    if (vf === null || vf > 3) {
      out.push({
        id: 'vf-stale', tone: 'warn',
        title: vf === null ? 'vFulfill never imported' : `vFulfill import is ${vf} days old`,
        detail: 'Delivery rates may be out of date',
      })
    }
    const c = cash()
    if (c && c.coversDays !== null && c.coversDays < 10) {
      out.push({ id: 'cash', tone: 'bad', title: `Cash covers ${Math.floor(c.coversDays)} days of spend`, detail: `${inr(c.total)} across bank, gateways and vFulfill` })
    }
    const rank = { bad: 0, warn: 1, good: 2 }
    return out.sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, 3)
  }

  /** Null until the cash sources are wired. */
  function cash() {
    if (!d.cash) return null
    const settlements = d.cash.settlements.reduce((s, x) => s + x.amount, 0)
    const total = d.cash.bank.amount + settlements + d.cash.vfulfillWallet + d.cash.codDue
    const weekSpend = d.campaignDays.filter((r) => r.date >= addDays(TODAY, -7) && r.date <= addDays(TODAY, -1)).reduce((s, r) => s + r.spend, 0)
    const dailySpend = weekSpend / 7
    return { ...d.cash, settlementsTotal: settlements, total, dailySpend, coversDays: dailySpend > 0 ? total / dailySpend : null }
  }

  function gst() {
    if (!d.gst) return null
    return { ...d.gst, owed: d.gst.outputTax - d.gst.inputCredit }
  }

  /** Month-to-date net (contribution − prorated fixed costs) and Vedaant's 50%. Null until fixed costs are wired. */
  function ownerShare() {
    if (d.fixedCostsMonthly === null) return null
    const month = portfolio(resolvePeriod('month'))
    const day = Number(TODAY.slice(8))
    const daysInMonth = new Date(Date.UTC(Number(TODAY.slice(0, 4)), Number(TODAY.slice(5, 7)), 0)).getUTCDate()
    const net = month.total.contribution - d.fixedCostsMonthly * (day / daysInMonth)
    return { net, share: net * 0.5 }
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

  const minutesAgo = (iso: string) => Math.max(0, Math.round((d.now.getTime() - Date.parse(iso)) / 60000))

  return {
    resolvePeriod, deliveryRate, codShare, skuEconomics, storeEconomics, profitBeforeAds, borrowedRates, storeStats, portfolio,
    series, calls, cash, gst, ownerShare, sync, campaigns, recentOrders, minutesAgo, relevantProducts,
    products: d.products, stores: d.stores, storeById, productOf,
    /** True when the store has never had a successful Meta sync, so "no ads" would really mean "no data". */
    metaNotConnected: (id: StoreId) => d.sync.metaNotConnected.includes(id),
  }
}

export type Metrics = ReturnType<typeof createMetrics>
