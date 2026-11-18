/**
 * Everything the screen shows is computed here from the data contract in
 * ./types. Pure functions over the rows passed in; no I/O.
 */
import {
  blendedBreakeven, breakeven, fromCpa, roasZone, SHEET_ASSUMPTIONS, type Assumptions, type Breakeven, type RoasZone,
} from './calculator'
import {
  addDays, CAMPAIGN_DAYS, CAMPAIGN_HOURS, CAMPAIGNS, CASH, FIXED_COSTS_MONTHLY, GST, HOUR_WEIGHTS, NOW, ORDER_HOURS, ORDERS,
  PRODUCTS, RECENT_ORDERS, RESOLVED, SHARE_UNTIL_NOW, STORES, SYNC, TODAY, productOf, storeById,
} from './mock'
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

export function resolvePeriod(id: PeriodId): Period {
  switch (id) {
    case 'today':
      return { id, from: TODAY, to: TODAY, prevFrom: addDays(TODAY, -1), prevTo: addDays(TODAY, -1), short: 'Today', range: `Today, ${fmtDay(TODAY)}`, prevLabel: 'yesterday by this hour' }
    case '30d':
      return { id, from: addDays(TODAY, -29), to: TODAY, prevFrom: addDays(TODAY, -59), prevTo: addDays(TODAY, -30), short: '30D', range: `${fmtDay(addDays(TODAY, -29))} – ${fmtDay(TODAY)}`, prevLabel: 'previous 30 days' }
    case 'month': {
      const from = `${TODAY.slice(0, 8)}01`
      const days = Number(TODAY.slice(8))
      const prevFrom = `${addDays(from, -1).slice(0, 8)}01`
      return { id, from, to: TODAY, prevFrom, prevTo: addDays(prevFrom, days - 1), short: 'Month', range: `${fmtDay(from)} – ${fmtDay(TODAY)}`, prevLabel: 'same days last month' }
    }
    default:
      return { id: '7d', from: addDays(TODAY, -6), to: TODAY, prevFrom: addDays(TODAY, -13), prevTo: addDays(TODAY, -7), short: '7D', range: `${fmtDay(addDays(TODAY, -6))} – ${fmtDay(TODAY)}`, prevLabel: 'previous 7 days' }
  }
}

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
const windowStart: Record<RateWindow, string> = { '7d': addDays(TODAY, -6), '30d': addDays(TODAY, -29), lifetime: '' }

/**
 * Delivered ÷ (delivered + RTO) for one product and payment type, over shipments
 * that closed in the window. Falls back product → store → VXP within that window alone.
 */
export function deliveryRate(storeId: StoreId, sku: string, payment: PaymentType, window: RateWindow = '30d'): Rate {
  const inWindow = RESOLVED.filter((r) => r.payment === payment && r.closedOn >= windowStart[window])
  for (const [basis, match] of levels(storeId, sku)) {
    const rs = inWindow.filter(match)
    const delivered = rs.reduce((s, r) => s + r.delivered, 0)
    const n = delivered + rs.reduce((s, r) => s + r.rto, 0)
    if (n >= MIN_SAMPLE) return { value: delivered / n, basis, n }
  }
  return { value: SHEET_RATES.deliveryRate, basis: 'sheet', n: 0 }
}

/** COD share of orders placed, trailing 30 days. Falls back product → store → VXP. */
export function codShare(storeId: StoreId, sku: string): Rate {
  const recent = ORDERS.filter((r) => r.date >= addDays(TODAY, -29) && r.date <= TODAY)
  for (const [basis, match] of levels(storeId, sku)) {
    const rs = recent.filter(match)
    const n = rs.reduce((s, r) => s + r.orders, 0)
    if (n >= MIN_SAMPLE) return { value: rs.filter((r) => r.payment === 'cod').reduce((s, r) => s + r.orders, 0) / n, basis, n }
  }
  return { value: SHEET_RATES.codShare, basis: 'sheet', n: 0 }
}

const assumptionsFor = (storeId: StoreId): Assumptions => ({ ...SHEET_ASSUMPTIONS, gatewayPct: storeById(storeId).gatewayPct })

export type SkuEconomics = Breakeven & { codShare: Rate; rates: Record<PaymentType, Rate> }

const ecoCache = new Map<string, SkuEconomics>()
/**
 * Breakeven for one product: today's price, COGS and weight, the store's fees, its
 * own COD share and delivery rates. Forward-looking, so it uses today's cost.
 */
export function skuEconomics(storeId: StoreId, sku: string): SkuEconomics {
  const key = `${storeId}:${sku}`
  const hit = ecoCache.get(key)
  if (hit) return hit
  const p = productOf(storeId, sku)
  const rates = { cod: deliveryRate(storeId, sku, 'cod'), prepaid: deliveryRate(storeId, sku, 'prepaid') }
  const share = codShare(storeId, sku)
  const eco = {
    ...blendedBreakeven(p, share.value, { cod: rates.cod.value, prepaid: rates.prepaid.value }, assumptionsFor(storeId)),
    codShare: share, rates,
  }
  ecoCache.set(key, eco)
  return eco
}

/** A store's breakeven: its products' economics weighted by their last 30 days of orders. */
export function storeEconomics(storeId: StoreId): Breakeven {
  const skus = PRODUCTS.filter((p) => p.storeId === storeId).map((p) => p.sku)
  const recent = ORDERS.filter((r) => r.storeId === storeId && r.date >= addDays(TODAY, -29))
  const w = skus.map((sku) => recent.filter((r) => r.sku === sku).reduce((s, r) => s + r.orders, 0))
  const wSum = w.reduce((s, x) => s + x, 0)
  const share = (i: number) => (wSum > 0 ? w[i] / wSum : 1 / skus.length)
  const ecos = skus.map((sku) => skuEconomics(storeId, sku))
  return fromCpa(
    ecos.reduce((s, e, i) => s + share(i) * e.avgPricePaid, 0),
    ecos.reduce((s, e, i) => s + share(i) * e.breakevenCpa, 0),
    assumptionsFor(storeId),
  )
}

type OrderRow = Omit<OrderDay, 'date'>
type SpendRow = Omit<CampaignDay, 'date'>

/**
 * Expected profit before ads for a group of orders (one product, one payment type):
 * at that type's delivery rate, with the orders' own costs, i.e. every line item at
 * its order-date COGS and the whole order's shipping slabs.
 */
export function profitBeforeAds(r: OrderRow): number {
  if (r.orders === 0) return 0
  const p = productOf(r.storeId, r.sku)
  const a = assumptionsFor(r.storeId)
  const pricePaid = r.revenue / r.orders
  // The calculator takes the COD list price; for prepaid, undo the prepaid discount to get it back.
  const listPrice = r.payment === 'cod' ? pricePaid : (pricePaid + a.prepaidFlat) / (1 - a.prepaidPct)
  const perOrder = breakeven({
    price: listPrice,
    cogs: r.cogs / r.orders,
    packedWeightGrams: p.packedWeightGrams,
    slabs500: r.slabs500 / r.orders,
    slabsKg: r.slabsKg / r.orders,
    deliveryRate: skuEconomics(r.storeId, r.sku).rates[r.payment].value,
    codShare: r.payment === 'cod' ? 1 : 0,
  }, a).breakevenCpa
  return r.orders * perOrder
}

/** Stores whose profit estimate borrows delivery rates from VXP or the sheet. */
export function borrowedRates(storeIds: StoreId[] = STORES.map((s) => s.id)): Store[] {
  return storeIds.filter((id) => PRODUCTS.some((p) => {
    if (p.storeId !== id) return false
    const { rates } = skuEconomics(p.storeId, p.sku)
    return rates.cod.basis === 'vxp' || rates.cod.basis === 'sheet' || rates.prepaid.basis === 'vxp' || rates.prepaid.basis === 'sheet'
  })).map(storeById)
}

// ── Aggregation ──────────────────────────────────────────────────────────────

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

const contributionOf = (s: Slice) =>
  s.orders.reduce((sum, o) => sum + profitBeforeAds(o), 0) - s.spend.reduce((sum, c) => sum + c.spend, 0)

const sliceIn = (storeIds: StoreId[], from: string, to: string): Slice => ({
  orders: ORDERS.filter((r) => storeIds.includes(r.storeId) && r.date >= from && r.date <= to),
  spend: CAMPAIGN_DAYS.filter((r) => storeIds.includes(r.storeId) && r.date >= from && r.date <= to),
})

/** For "today" the previous period is yesterday up to the same hour. */
function prevSlice(storeIds: StoreId[], p: Period): Slice {
  const s = sliceIn(storeIds, p.prevFrom, p.prevTo)
  if (p.id !== 'today') return s
  const k = SHARE_UNTIL_NOW
  return {
    orders: s.orders.map((o) => ({ ...o, orders: o.orders * k, units: o.units * k, revenue: o.revenue * k, cogs: o.cogs * k, slabs500: o.slabs500 * k, slabsKg: o.slabsKg * k })),
    spend: s.spend.map((c) => ({ ...c, spend: c.spend * k, impressions: c.impressions * k, clicks: c.clicks * k, metaPurchases: c.metaPurchases * k, attributedOrders: c.attributedOrders * k })),
  }
}

export type StoreStats = Totals & {
  store: Store
  economics: Breakeven
  roas: number | null
  zone: RoasZone | null
  cpa: number | null
  cpm: number | null
  ctr: number | null
  /** Projected contribution: Σ profit before ads (per product × payment type, own costs) − spend. An estimate until orders resolve. */
  contribution: number
  /** Spend whose ad URL matched no product handle. Already inside `spend`. */
  unmappedSpend: number
  prev: Totals & { roas: number | null; cpm: number | null; contribution: number }
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null)

export function storeStats(storeId: StoreId, p: Period): StoreStats {
  const store = storeById(storeId)
  const economics = storeEconomics(storeId)
  const slice = sliceIn([storeId], p.from, p.to)
  const t = totalsOf(slice)
  const prev = prevSlice([storeId], p)
  const pt = totalsOf(prev)
  const roas = ratio(t.revenue, t.spend)
  return {
    ...t, store, economics, roas,
    zone: roas === null ? null : roasZone(roas, economics),
    cpa: ratio(t.spend, t.orders),
    cpm: t.impressions > 0 ? (t.spend / t.impressions) * 1000 : null,
    ctr: ratio(t.clicks, t.impressions),
    contribution: contributionOf(slice),
    unmappedSpend: slice.spend.filter((r) => r.sku === null).reduce((sum, r) => sum + r.spend, 0),
    prev: {
      ...pt,
      roas: ratio(pt.revenue, pt.spend),
      cpm: pt.impressions > 0 ? (pt.spend / pt.impressions) * 1000 : null,
      contribution: contributionOf(prev),
    },
  }
}

export type Portfolio = {
  stores: StoreStats[]
  total: Totals & { contribution: number; prevContribution: number; prevRevenue: number; prevSpend: number; roas: number | null }
}

export function portfolio(p: Period, storeIds: StoreId[] = STORES.map((s) => s.id)): Portfolio {
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

/** Buckets for the pace chart: hours for Today, days otherwise. */
export function series(storeIds: StoreId[], p: Period): SeriesPoint[] {
  const bucket = (s: Slice) => {
    const t = totalsOf(s)
    return { revenue: t.revenue, spend: t.spend, profit: contributionOf(s) }
  }

  let buckets: { key: string; label: string; revenue: number; spend: number; profit: number }[]
  let prev: number[]
  if (p.id === 'today') {
    const inStores = <T extends { storeId: StoreId }>(rows: T[]) => rows.filter((r) => storeIds.includes(r.storeId))
    const orders = inStores(ORDER_HOURS)
    const spend = inStores(CAMPAIGN_HOURS)
    const hours = [...new Set([...orders, ...spend].map((h) => h.hour))].sort((a, b) => a - b)
    buckets = hours.map((hour) => ({
      key: String(hour),
      label: new Date(Date.UTC(2026, 0, 1, hour)).toLocaleTimeString('en-IN', { hour: 'numeric', hour12: true, timeZone: 'UTC' }),
      ...bucket({ orders: orders.filter((h) => h.hour === hour), spend: spend.filter((h) => h.hour === hour) }),
    }))
    const yRev = totalsOf(sliceIn(storeIds, p.prevFrom, p.prevTo)).revenue
    const wTotal = HOUR_WEIGHTS.reduce((s, w) => s + w, 0)
    prev = buckets.map((b) => (yRev * HOUR_WEIGHTS.slice(0, Number(b.key) + 1).reduce((s, w) => s + w, 0)) / wTotal)
  } else {
    const days: string[] = []
    for (let d = p.from; d <= p.to; d = addDays(d, 1)) days.push(d)
    buckets = days.map((d) => ({ key: d, label: fmtDay(d), ...bucket(sliceIn(storeIds, d, d)) }))
    prev = days.map((_, i) => totalsOf(sliceIn(storeIds, p.prevFrom, addDays(p.prevFrom, i))).revenue)
  }
  let cr = 0, cs = 0, cp = 0
  return buckets.map((b, i) => {
    cr += b.revenue; cs += b.spend; cp += b.profit
    return { ...b, cumRevenue: cr, cumSpend: cs, cumProfit: cp, prevCumRevenue: prev[i] ?? null }
  })
}

export type Call = {
  id: string
  tone: 'bad' | 'warn' | 'good'
  storeId?: StoreId
  title: string
  detail: string
}

/** "Needs your call": facts only, at most three, worst first. Empty is a valid answer. */
export function calls(p: Period, storeIds: StoreId[] = STORES.map((s) => s.id)): Call[] {
  const out: Call[] = []
  for (const id of storeIds) {
    const store = storeById(id)
    const eco = storeEconomics(id)
    const last3 = sliceIn([id], addDays(TODAY, -3), addDays(TODAY, -1))
    // Combined, not day by day: at 2–3 orders a day a single day's ROAS is mostly noise.
    const t = totalsOf(last3)
    const daysWithSpend = new Set(CAMPAIGN_DAYS.filter((r) => r.storeId === id && r.date >= addDays(TODAY, -3) && r.date <= addDays(TODAY, -1)).map((r) => r.date)).size
    if (daysWithSpend === 3 && t.spend > 0 && t.revenue / t.spend < eco.breakevenRoas) {
      out.push({
        id: `${id}-below`, tone: 'bad', storeId: id,
        title: `${store.name} below breakeven over the last 3 days`,
        detail: `ROAS ${fmtX(t.revenue / t.spend)} vs ${fmtX(eco.breakevenRoas)} breakeven · ${t.orders} orders · ${inr(t.spend)} spent`,
      })
    }
    const s = storeStats(id, p)
    if (s.zone === 'profit' && s.orders >= 10) {
      out.push({
        id: `${id}-target`, tone: 'good', storeId: id,
        title: `${store.name} above your target`,
        detail: `ROAS ${fmtX(s.roas!)} vs ${fmtX(eco.targetRoas)} target · ${s.orders} orders`,
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
  if (SYNC.vfulfillImportDaysAgo > 3) {
    out.push({
      id: 'vf-stale', tone: 'warn',
      title: `vFulfill import is ${SYNC.vfulfillImportDaysAgo} days old`,
      detail: 'Delivery rates may be out of date',
    })
  }
  const c = cash()
  if (c.coversDays !== null && c.coversDays < 10) {
    out.push({ id: 'cash', tone: 'bad', title: `Cash covers ${Math.floor(c.coversDays)} days of spend`, detail: `${inr(c.total)} across bank, gateways and vFulfill` })
  }
  const rank = { bad: 0, warn: 1, good: 2 }
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, 3)
}

export function cash() {
  const settlements = CASH.settlements.reduce((s, x) => s + x.amount, 0)
  const total = CASH.bank.amount + settlements + CASH.vfulfillWallet + CASH.codDue
  const weekSpend = CAMPAIGN_DAYS.filter((r) => r.date >= addDays(TODAY, -7) && r.date <= addDays(TODAY, -1)).reduce((s, r) => s + r.spend, 0)
  const dailySpend = weekSpend / 7
  return { ...CASH, settlementsTotal: settlements, total, dailySpend, coversDays: dailySpend > 0 ? total / dailySpend : null }
}

export function gst() {
  return { ...GST, owed: GST.outputTax - GST.inputCredit }
}

/** Month-to-date net (contribution − prorated fixed costs) and Vedaant's 50%. */
export function ownerShare() {
  const month = portfolio(resolvePeriod('month'))
  const day = Number(TODAY.slice(8))
  const daysInMonth = new Date(Date.UTC(Number(TODAY.slice(0, 4)), Number(TODAY.slice(5, 7)), 0)).getUTCDate()
  const net = month.total.contribution - FIXED_COSTS_MONTHLY * (day / daysInMonth)
  return { net, share: net * 0.5 }
}

export const sync = () => SYNC

/**
 * Each campaign's own Meta spend and the Shopify orders carrying its campaign ID.
 * Orders without a campaign ID (organic, or lost at checkout) belong to no campaign.
 */
export function campaigns(storeId: StoreId, p: Period) {
  const rows = CAMPAIGN_DAYS.filter((r) => r.storeId === storeId && r.date >= p.from && r.date <= p.to)
  return CAMPAIGNS.filter((c) => c.storeId === storeId).map((c) => {
    const own = rows.filter((r) => r.campaignId === c.id)
    const spend = own.reduce((s, r) => s + r.spend, 0)
    const orders = own.reduce((s, r) => s + r.attributedOrders, 0)
    const cpa = ratio(spend, orders)
    const beCpa = c.sku ? skuEconomics(storeId, c.sku).breakevenCpa : null
    return {
      ...c, spend, orders, cpa,
      vsBreakeven: cpa !== null && beCpa ? cpa / beCpa : null,
      /** Zero orders but spent more than one order's breakeven CPA: a total loss, not a missing number. */
      noSalesLoss: orders === 0 && beCpa !== null && spend > beCpa,
    }
  }).filter((c) => c.spend > 0)
}

export function recentOrders(storeIds: StoreId[], limit: number) {
  return RECENT_ORDERS.filter((o) => storeIds.includes(o.storeId)).slice(0, limit)
}

export const minutesAgo = (iso: string) => Math.max(0, Math.round((NOW.getTime() - Date.parse(iso)) / 60000))

// ── Formatting (Indian digit grouping) ───────────────────────────────────────
const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
export const inr = (n: number) => `${n < 0 ? '−' : ''}₹${inrFmt.format(Math.abs(Math.round(n)))}`
export const fmtX = (n: number) => `${n.toFixed(2)}×`
export const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`
