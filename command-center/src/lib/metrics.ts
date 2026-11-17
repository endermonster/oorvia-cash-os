/**
 * Everything the screen shows is computed here from the data contract in
 * ./types. Pure functions over the rows passed in; no I/O.
 */
import { breakeven, roasZone, type Breakeven, type RoasZone } from './calculator'
import {
  addDays, CAMPAIGNS, CASH, DAILY, FIXED_COSTS_MONTHLY, GST, HOUR_WEIGHTS, HOURLY_TODAY, NOW, RECENT_ORDERS,
  SHARE_UNTIL_NOW, STORES, SYNC, TODAY, storeById,
} from './mock'
import type { DailyRow, Store, StoreId } from './types'

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

export function storeEconomics(store: Store): Breakeven {
  return breakeven({ ...store.product, deliveryRate: store.deliveryRate.value, codShare: store.codShare.value })
}

type Totals = Pick<DailyRow, 'spend' | 'impressions' | 'clicks' | 'metaPurchases' | 'orders' | 'codOrders' | 'revenue'>
const zero = (): Totals => ({ spend: 0, impressions: 0, clicks: 0, metaPurchases: 0, orders: 0, codOrders: 0, revenue: 0 })
function add(t: Totals, r: Totals) {
  t.spend += r.spend; t.impressions += r.impressions; t.clicks += r.clicks; t.metaPurchases += r.metaPurchases
  t.orders += r.orders; t.codOrders += r.codOrders; t.revenue += r.revenue
  return t
}

const rowsIn = (storeIds: StoreId[], from: string, to: string) =>
  DAILY.filter((r) => storeIds.includes(r.storeId) && r.date >= from && r.date <= to)

/** For "today" the previous period is yesterday up to the same hour. */
function prevRows(storeIds: StoreId[], p: Period): Totals[] {
  const rows = rowsIn(storeIds, p.prevFrom, p.prevTo)
  return p.id === 'today' ? rows.map((r) => scale(r, SHARE_UNTIL_NOW)) : rows
}

function scale(r: Totals, k: number): Totals {
  return {
    spend: r.spend * k, impressions: r.impressions * k, clicks: r.clicks * k, metaPurchases: r.metaPurchases * k,
    orders: r.orders * k, codOrders: r.codOrders * k, revenue: r.revenue * k,
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
  /** Projected contribution: orders × breakeven CPA − spend. An estimate until orders resolve. */
  contribution: number
  realised: number
  prev: Totals & { roas: number | null; cpm: number | null; contribution: number }
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null)

/** Share of an order cohort that has resolved (delivered or RTO) by now. Mock curve. */
const resolvedShare = (date: string) => {
  const age = (Date.parse(TODAY) - Date.parse(date)) / 864e5
  return Math.min(1, Math.max(0, (age - 3) / 7))
}

export function storeStats(storeId: StoreId, p: Period): StoreStats {
  const store = storeById(storeId)
  const economics = storeEconomics(store)
  const rows = rowsIn([storeId], p.from, p.to)
  const t = rows.reduce(add, zero())
  const pt = prevRows([storeId], p).reduce(add, zero())
  const contribution = t.orders * economics.breakevenCpa - t.spend
  const realised = rows.reduce((s, r) => s + (r.orders * economics.breakevenCpa - r.spend) * resolvedShare(r.date), 0)
  const roas = ratio(t.revenue, t.spend)
  return {
    ...t, store, economics, roas,
    zone: roas === null ? null : roasZone(roas, economics),
    cpa: ratio(t.spend, t.orders),
    cpm: t.impressions > 0 ? (t.spend / t.impressions) * 1000 : null,
    ctr: ratio(t.clicks, t.impressions),
    contribution, realised,
    prev: {
      ...pt,
      roas: ratio(pt.revenue, pt.spend),
      cpm: pt.impressions > 0 ? (pt.spend / pt.impressions) * 1000 : null,
      contribution: pt.orders * economics.breakevenCpa - pt.spend,
    },
  }
}

export type Portfolio = {
  stores: StoreStats[]
  total: Totals & { contribution: number; realised: number; prevContribution: number; roas: number | null }
}

export function portfolio(p: Period, storeIds: StoreId[] = STORES.map((s) => s.id)): Portfolio {
  const stores = storeIds.map((id) => storeStats(id, p)).sort((a, b) => b.contribution - a.contribution)
  const total = stores.reduce((t, s) => add(t, s), zero())
  return {
    stores,
    total: {
      ...total,
      contribution: stores.reduce((s, x) => s + x.contribution, 0),
      realised: stores.reduce((s, x) => s + x.realised, 0),
      prevContribution: stores.reduce((s, x) => s + x.prev.contribution, 0),
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
  const be = new Map(storeIds.map((id) => [id, storeEconomics(storeById(id)).breakevenCpa]))
  const profitOf = (r: { storeId: StoreId; orders: number; spend: number }) => r.orders * be.get(r.storeId)! - r.spend

  let buckets: { key: string; label: string; revenue: number; spend: number; profit: number }[]
  let prev: number[]
  if (p.id === 'today') {
    const hours = [...new Set(HOURLY_TODAY.map((h) => h.hour))].sort((a, b) => a - b)
    buckets = hours.map((hour) => {
      const rs = HOURLY_TODAY.filter((h) => h.hour === hour && storeIds.includes(h.storeId))
      return {
        key: String(hour),
        label: new Date(Date.UTC(2026, 0, 1, hour)).toLocaleTimeString('en-IN', { hour: 'numeric', hour12: true, timeZone: 'UTC' }),
        revenue: rs.reduce((s, r) => s + r.revenue, 0),
        spend: rs.reduce((s, r) => s + r.spend, 0),
        profit: rs.reduce((s, r) => s + profitOf(r), 0),
      }
    })
    const yRev = rowsIn(storeIds, p.prevFrom, p.prevTo).reduce((s, r) => s + r.revenue, 0)
    const wTotal = HOUR_WEIGHTS.reduce((s, w) => s + w, 0)
    prev = buckets.map((b) => (yRev * HOUR_WEIGHTS.slice(0, Number(b.key) + 1).reduce((s, w) => s + w, 0)) / wTotal)
  } else {
    const days: string[] = []
    for (let d = p.from; d <= p.to; d = addDays(d, 1)) days.push(d)
    buckets = days.map((d) => {
      const rs = rowsIn(storeIds, d, d)
      return {
        key: d, label: fmtDay(d),
        revenue: rs.reduce((s, r) => s + r.revenue, 0),
        spend: rs.reduce((s, r) => s + r.spend, 0),
        profit: rs.reduce((s, r) => s + profitOf(r), 0),
      }
    })
    const prevDays = rowsIn(storeIds, p.prevFrom, p.prevTo)
    prev = days.map((_, i) => prevDays.filter((r) => r.date <= addDays(p.prevFrom, i)).reduce((s, r) => s + r.revenue, 0))
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
    const eco = storeEconomics(store)
    const last3 = [1, 2, 3].map((n) => rowsIn([id], addDays(TODAY, -n), addDays(TODAY, -n))[0]).filter(Boolean)
    // Combined, not day by day: at 2–3 orders a day a single day's ROAS is mostly noise.
    const t = last3.reduce(add, zero())
    if (last3.length === 3 && t.spend > 0 && t.revenue / t.spend < eco.breakevenRoas) {
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
      detail: 'Delivery rates and realised profit may be out of date',
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
  const week = rowsIn(STORES.map((s) => s.id), addDays(TODAY, -7), addDays(TODAY, -1))
  const dailySpend = week.reduce((s, r) => s + r.spend, 0) / 7
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

export function campaigns(storeId: StoreId, p: Period) {
  const s = storeStats(storeId, p)
  return CAMPAIGNS.filter((c) => c.storeId === storeId).map((c) => {
    const spend = s.spend * c.spendShare
    const cpa = s.cpa ? s.cpa * c.cpaFactor : null
    const orders = cpa ? Math.round(spend / cpa) : 0
    return { ...c, spend, orders, cpa, vsBreakeven: cpa ? cpa / s.economics.breakevenCpa : null }
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
