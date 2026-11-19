/**
 * MOCK DATA. Deterministic, shaped like the real sources, so the screen can be
 * judged before any backend exists. Products, prices and costs are real (Shopify,
 * 2026-11-18) except Selnova's placeholders. The generator's 84.8% delivery and 68%
 * COD share are Oorvia's real Mar–Aug averages (old Cash OS, mostly Yubi). Orders,
 * spend and resolved counts are invented.
 */
import { breakeven } from './calculator'
import { addDays } from './dates'
import type { Data } from './data'
import type {
  Campaign, CampaignDay, CampaignHour, CashPosition, GstPosition, OrderDay, OrderHour, PaymentType, Product, RecentOrder,
  ResolvedDay, Store, StoreId, SyncStatus,
} from './types'

/** The mock's fixed "now": 18 Nov 2026, 3:20 PM IST. */
export const NOW = new Date('2026-11-18T15:20:00+05:30')
export const TODAY = '2026-11-18'
export const NOW_HOUR = 15
export const NOW_MINUTE = 20

// Gateway fees: the sheet's 2% for every store until settlement reports are wired.
export const STORES: Store[] = [
  { id: 'oorvia', name: 'Oorvia', liveSince: '2026-03-21', gateways: ['Cashfree', 'Razorpay'], gatewayPct: 0.02 },
  { id: 'kaiven', name: 'Kaiven', liveSince: '2026-11-10', gateways: ['Razorpay', 'PayU'], gatewayPct: 0.02 },
  { id: 'selnova', name: 'Selnova', liveSince: '2026-11-13', gateways: ['Razorpay'], gatewayPct: 0.02 },
]

export const storeById = (id: StoreId) => STORES.find((s) => s.id === id)!

export const PRODUCTS: (Product & { cogs: number })[] = [
  // Oorvia: Shopify (2026-11-18). 11 other products are still Active there but have no orders since Aug
  // (Yubi YB31 was the last seller, 16 Aug); left out until they sell again.
  { sku: 'OMS-1M', storeId: 'oorvia', name: 'Microinfusion System', price: 2499, cogs: 581, packedWeightGrams: 500, liveSince: '2026-09-16', handle: 'oorvia-microinfusion-system', stage: 'live' },
  // Kaiven and Selnova: active products from Shopify (2026-11-18). Drafts left out (DermFirm Eye Lift, Pillowcast).
  // Shopify weight is 0 on both, so the sheet's 500 g stands. Selnova has no SKU and no cost per item in Shopify yet:
  // 'SN-PDRN' and ₹350 are placeholders.
  { sku: 'KV-DHS', storeId: 'kaiven', name: 'Medicube Deoxyribose Scalp Serum', price: 1499, cogs: 300, packedWeightGrams: 500, liveSince: '2026-11-10', handle: 'deoxyribose-scalp-serum', stage: 'testing' },
  { sku: 'SN-PDRN', storeId: 'selnova', name: 'PDRN Pink Vitamin Glow Ampoule', price: 1499, cogs: 350, packedWeightGrams: 500, liveSince: '2026-11-13', handle: 'pdrn-ampoule', stage: 'testing' },
]

/** A product is (store, SKU): two stores may sell the same SKU. */
export function productOf(storeId: StoreId, sku: string): Product {
  const p = PRODUCTS.find((x) => x.storeId === storeId && x.sku === sku)
  if (!p) throw new Error(`No product ${sku} in ${storeId}`)
  return p
}

/** Time-versioned COGS (ex-GST), as `cogs_history`. One entry each: no cost change is on record yet. */
export const COGS_HISTORY: { storeId: StoreId; sku: string; cogs: number; from: string }[] =
  PRODUCTS.map((p) => ({ storeId: p.storeId, sku: p.sku, cogs: p.cogs, from: '2026-01-01' }))

/** The cost effective on a date: the latest entry starting on or before it. */
export function cogsOn(storeId: StoreId, sku: string, date: string): number {
  const hit = COGS_HISTORY
    .filter((c) => c.storeId === storeId && c.sku === sku && c.from <= date)
    .sort((a, b) => b.from.localeCompare(a.from))[0]
  if (!hit) throw new Error(`No cost for ${sku} in ${storeId} on ${date}`)
  return hit.cogs
}

/** What the generator assumes the true rates are. Not visible to the screen. */
const GEN = { deliveryRate: 0.848, codShare: 0.68 }
/** Invented true delivery rates per payment type, used to resolve the mock's orders. */
const GEN_DELIVERY: Record<PaymentType, number> = { cod: 0.8, prepaid: 0.95 }

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export { addDays }

function poisson(mean: number, rnd: () => number) {
  if (mean <= 0) return 0
  const L = Math.exp(-mean)
  let k = 0, p = 1
  do { k++; p *= rnd() } while (p > L)
  return k - 1
}

/** Hour-of-day weights for Indian D2C orders (IST). */
export const HOUR_WEIGHTS = [0.3, 0.2, 0.1, 0.1, 0.1, 0.2, 0.4, 0.7, 0.9, 1, 1.1, 1.2, 1.3, 1.2, 1.1, 1.1, 1.2, 1.3, 1.5, 1.7, 1.9, 1.8, 1.4, 0.8]
export const SHARE_UNTIL_NOW = HOUR_WEIGHTS.slice(0, NOW_HOUR + 1).reduce((s, w) => s + w, 0) / HOUR_WEIGHTS.reduce((s, w) => s + w, 0)

/** Spend and ROAS (as a multiple of breakeven) per store per day. */
function plan(storeId: StoreId, date: string, rnd: () => number): { spend: number; roasMult: number; organic: number } {
  const ageFrom = (start: string) => Math.round((Date.parse(date) - Date.parse(start)) / 864e5)
  if (storeId === 'oorvia') {
    if (date <= '2026-11-10') return { spend: 2000 + rnd() * 1600, roasMult: 0.95 + rnd() * 0.35, organic: 0.3 }
    return { spend: 0, roasMult: 0, organic: 0.6 }
  }
  if (storeId === 'kaiven') {
    const age = ageFrom('2026-11-10')
    if (age < 0) return { spend: 0, roasMult: 0, organic: 0 }
    // 13 Nov: a creative fatigued for a day, so the profit panel shows a losing day.
    const roasMult = date === '2026-11-13' ? 0.62 : 1.3 + rnd() * 0.25
    return { spend: 1800 + age * 210 + rnd() * 500, roasMult, organic: 0.2 }
  }
  const age = ageFrom('2026-11-13')
  if (age < 0) return { spend: 0, roasMult: 0, organic: 0 }
  const late = date >= '2026-11-15'
  return { spend: 1200 + age * 160 + rnd() * 300, roasMult: late ? 0.72 + rnd() * 0.08 : 1.08 + rnd() * 0.12, organic: 0.1 }
}

/** Every campaign lands on one product page. */
export const CAMPAIGNS: Campaign[] = [
  { id: 'kv1', storeId: 'kaiven', sku: 'KV-DHS', name: 'Scalp – Broad' },
  { id: 'kv2', storeId: 'kaiven', sku: 'KV-DHS', name: 'Scalp – Hair fall 25–40' },
  { id: 'kv3', storeId: 'kaiven', sku: 'KV-DHS', name: 'DHS – Creative test' },
  { id: 'sn1', storeId: 'selnova', sku: 'SN-PDRN', name: 'PDRN – Broad' },
  { id: 'sn2', storeId: 'selnova', sku: 'SN-PDRN', name: 'PDRN – Glass skin 22–35' },
  { id: 'ov1', storeId: 'oorvia', sku: 'OMS-1M', name: 'MI – Broad (paused 10 Nov)' },
]
/** Mock only: each campaign's share of its product's spend, and how its CPA compares with the product's. */
const CAMPAIGN_GEN: Record<string, { spendShare: number; cpaFactor: number }> = {
  kv1: { spendShare: 0.58, cpaFactor: 0.9 }, kv2: { spendShare: 0.3, cpaFactor: 1.02 }, kv3: { spendShare: 0.12, cpaFactor: 1.6 },
  sn1: { spendShare: 0.64, cpaFactor: 0.94 }, sn2: { spendShare: 0.36, cpaFactor: 1.12 },
  ov1: { spendShare: 1, cpaFactor: 1 },
}

/** Splits `total` whole units across weights (largest remainder), so the parts add up exactly. */
function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0)
  const raw = weights.map((w) => (sum > 0 ? (total * w) / sum : 0))
  const out = raw.map(Math.floor)
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0])
  const left = total - out.reduce((s, x) => s + x, 0)
  for (let k = 0; k < left; k++) out[order[k][1]]++
  return out
}

/** 8% of orders are 2 units (mock). Prepaid pays ₹100 less per order. */
function buildOrdersAndSpend(): { orders: OrderDay[]; spend: CampaignDay[] } {
  const orders: OrderDay[] = []
  const spendRows: CampaignDay[] = []
  for (const product of PRODUCTS) {
    const store = storeById(product.storeId)
    const be = breakeven({ ...product, ...GEN })
    const camps = CAMPAIGNS.filter((c) => c.storeId === product.storeId && c.sku === product.sku)
    const rnd = mulberry32(store.id.length * 7919 + product.price)
    for (let date = '2026-09-15'; date <= TODAY; date = addDays(date, 1)) {
      const p = plan(store.id, date, rnd)
      const partial = date === TODAY ? SHARE_UNTIL_NOW : 1
      const spend = Math.round(p.spend * partial)
      // Near-deterministic so each store's story (above / below breakeven) survives small daily counts.
      const mean = (spend * be.breakevenRoas * p.roasMult) / be.avgPricePaid
      const paidOrders = spend > 0 ? Math.max(0, Math.round(mean + (rnd() - 0.5) * 0.9)) : 0
      const count = paidOrders + poisson(p.organic * partial, rnd)

      const empty = (payment: PaymentType): OrderDay =>
        ({ date, storeId: store.id, sku: product.sku, payment, orders: 0, units: 0, revenue: 0, cogs: 0, slabs500: 0, slabsKg: 0, ordersMissingCogs: 0 })
      const byPay: Record<PaymentType, OrderDay> = { cod: empty('cod'), prepaid: empty('prepaid') }
      for (let i = 0; i < count; i++) {
        const row = byPay[rnd() < GEN.codShare ? 'cod' : 'prepaid']
        const units = rnd() < 0.08 ? 2 : 1
        const grams = product.packedWeightGrams * units
        row.orders++
        row.units += units
        row.revenue += product.price * units - (row.payment === 'prepaid' ? 100 : 0)
        row.cogs += cogsOn(product.storeId, product.sku, date) * units
        row.slabs500 += Math.max(1, Math.ceil(grams / 500))
        row.slabsKg += Math.max(1, Math.ceil(grams / 1000))
      }
      for (const row of Object.values(byPay)) if (row.orders > 0) orders.push(row)

      if (spend === 0 || camps.length === 0) continue
      const late = date >= '2026-11-15'
      const cpm = store.id === 'kaiven' && late ? 400 + rnd() * 40 : 320 + rnd() * 50
      const ctr = 0.016 + rnd() * 0.005
      // About 1 day in 10, one paid order loses its campaign ID on the way through checkout.
      const lost = rnd() < 0.1 ? 1 : 0
      const attributed = allocate(Math.max(0, paidOrders - lost), camps.map((c) => CAMPAIGN_GEN[c.id].spendShare / CAMPAIGN_GEN[c.id].cpaFactor))
      const spends = allocate(spend, camps.map((c) => CAMPAIGN_GEN[c.id].spendShare))
      camps.forEach((c, i) => {
        const impressions = Math.round((spends[i] / cpm) * 1000)
        spendRows.push({
          date, storeId: store.id, campaignId: c.id, sku: c.sku,
          spend: spends[i], impressions, clicks: Math.round(impressions * ctr),
          metaPurchases: Math.max(0, attributed[i] - (rnd() < 0.25 ? 1 : 0)),
          attributedOrders: attributed[i],
        })
      })
    }
  }
  return { orders, spend: spendRows }
}

const BUILT = buildOrdersAndSpend()
export const ORDERS: OrderDay[] = BUILT.orders
export const CAMPAIGN_DAYS: CampaignDay[] = BUILT.spend

/** Each mock order resolves: delivered after 4–7 days, RTO after 10–16. Counted on the day it closes. */
function buildResolved(): ResolvedDay[] {
  const byKey = new Map<string, ResolvedDay>()
  const rnd = mulberry32(9001)
  for (const r of ORDERS) {
    for (let i = 0; i < r.orders; i++) {
      const delivered = rnd() < GEN_DELIVERY[r.payment]
      const closedOn = addDays(r.date, delivered ? 4 + Math.floor(rnd() * 4) : 10 + Math.floor(rnd() * 7))
      if (closedOn > TODAY) continue
      const key = `${closedOn}|${r.storeId}|${r.sku}|${r.payment}`
      const row = byKey.get(key) ?? { closedOn, storeId: r.storeId, sku: r.sku, payment: r.payment, delivered: 0, rto: 0 }
      if (delivered) row.delivered++
      else row.rto++
      byKey.set(key, row)
    }
  }
  return [...byKey.values()].sort((a, b) => a.closedOn.localeCompare(b.closedOn))
}

/** All invented: old Cash OS stops at 24 Aug, before Microinfusion launched. */
export const RESOLVED: ResolvedDay[] = buildResolved()

/** Hour weights for hours 0..lastHour of a day. */
const weightsTo = (lastHour: number) => HOUR_WEIGHTS.slice(0, lastHour + 1)
function pickHour(rnd: () => number, w: number[]) {
  let x = rnd() * w.reduce((s, v) => s + v, 0)
  for (let h = 0; h < w.length; h++) { x -= w[h]; if (x <= 0) return h }
  return w.length - 1
}

/** One day's orders by hour, hours 0..lastHour: each order gets an hour; a row's amounts split in proportion to its orders. */
function buildOrderHours(date: string, lastHour: number, seed: number): OrderHour[] {
  const out: OrderHour[] = []
  const w = weightsTo(lastHour)
  const rnd = mulberry32(seed)
  for (const r of ORDERS.filter((x) => x.date === date)) {
    const perHour = new Array<number>(lastHour + 1).fill(0)
    for (let i = 0; i < r.orders; i++) perHour[pickHour(rnd, w)]++
    perHour.forEach((n, hour) => {
      if (n === 0) return
      const k = n / r.orders
      out.push({
        hour, storeId: r.storeId, sku: r.sku, payment: r.payment, orders: n,
        units: r.units * k, revenue: r.revenue * k, cogs: r.cogs * k, slabs500: r.slabs500 * k, slabsKg: r.slabsKg * k,
      })
    })
  }
  return out
}

/** One day's spend by hour, hours 0..lastHour, along the hour-of-day curve. Every campaign row is kept, orders or not. */
function buildCampaignHours(date: string, lastHour: number, seed: number): CampaignHour[] {
  const out: CampaignHour[] = []
  const w = weightsTo(lastHour)
  const wSum = w.reduce((s, x) => s + x, 0)
  const rnd = mulberry32(seed)
  for (const r of CAMPAIGN_DAYS.filter((x) => x.date === date)) {
    const spends = allocate(r.spend, w)
    const attributed = new Array<number>(lastHour + 1).fill(0)
    for (let i = 0; i < r.attributedOrders; i++) attributed[pickHour(rnd, w)]++
    spends.forEach((spend, hour) => {
      const k = w[hour] / wSum
      out.push({
        hour, storeId: r.storeId, campaignId: r.campaignId, sku: r.sku, spend,
        impressions: Math.round(r.impressions * k), clicks: Math.round(r.clicks * k),
        metaPurchases: Math.min(attributed[hour], Math.round(r.metaPurchases * k)), attributedOrders: attributed[hour],
      })
    })
  }
  return out
}

export const YESTERDAY = addDays(TODAY, -1)
export const ORDER_HOURS: OrderHour[] = buildOrderHours(TODAY, NOW_HOUR, 31)
export const CAMPAIGN_HOURS: CampaignHour[] = buildCampaignHours(TODAY, NOW_HOUR, 37)
/** Yesterday, all 24 hours: what Today is compared against, up to the current hour. */
export const ORDER_HOURS_YESTERDAY: OrderHour[] = buildOrderHours(YESTERDAY, 23, 32)
export const CAMPAIGN_HOURS_YESTERDAY: CampaignHour[] = buildCampaignHours(YESTERDAY, 23, 38)

const CITIES = ['Bengaluru', 'Mumbai', 'Pune', 'Delhi', 'Hyderabad', 'Jaipur', 'Lucknow', 'Kochi', 'Indore', 'Chennai', 'Ahmedabad', 'Surat', 'Nagpur', 'Kolkata', 'Chandigarh']

function buildRecentOrders(): RecentOrder[] {
  const out: RecentOrder[] = []
  const rnd = mulberry32(4242)
  for (const h of ORDER_HOURS) {
    const product = productOf(h.storeId, h.sku)
    for (let i = 0; i < h.orders; i++) {
      const minute = h.hour === NOW_HOUR ? Math.floor(rnd() * 18) : Math.floor(rnd() * 60)
      const placed = new Date(`${TODAY}T${String(h.hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`)
      out.push({
        id: `${h.storeId}-${h.hour}-${h.payment}-${i}`,
        storeId: h.storeId,
        placedAt: placed.toISOString(),
        sku: product.sku,
        product: product.name,
        value: Math.round(h.revenue / h.orders),
        payment: h.payment,
        city: CITIES[Math.floor(rnd() * CITIES.length)],
      })
    }
  }
  return out.sort((a, b) => b.placedAt.localeCompare(a.placedAt))
}

export const RECENT_ORDERS: RecentOrder[] = buildRecentOrders()

export const CASH: CashPosition = {
  asOf: NOW.toISOString(),
  bank: { amount: 58050, enteredAt: '2026-11-16' },
  settlements: [
    { gateway: 'Razorpay', storeId: 'kaiven', amount: 9840 },
    { gateway: 'PayU', storeId: 'kaiven', amount: 6120 },
    { gateway: 'Razorpay', storeId: 'selnova', amount: 4380 },
    { gateway: 'Cashfree', storeId: 'oorvia', amount: 2950 },
  ],
  vfulfillWallet: 14800,
  codDue: 38900,
}

export const GST: GstPosition = { month: '2026-11', outputTax: 16940, inputCredit: 5660, dueDate: '2026-12-20' }

/** Monthly fixed costs (Shopify plans, apps, Claude, etc.). Mock, near April's real ₹14,210. */
export const FIXED_COSTS_MONTHLY = 14200

export const SYNC: SyncStatus = { metaMinutesAgo: 4, metaNotConnected: [], shopifyMinutesAgo: 1, vfulfillImportDaysAgo: 4 }

/**
 * The mock as one Data object. Built from the same array instances the named exports
 * hold, so a test that pushes into RESOLVED or CAMPAIGN_DAYS is seen through MOCK.
 */
export const MOCK: Data = {
  now: NOW, today: TODAY, nowHour: NOW_HOUR, nowMinute: NOW_MINUTE, source: 'mock',
  stores: STORES, products: PRODUCTS, orders: ORDERS,
  orderHours: ORDER_HOURS, orderHoursYesterday: ORDER_HOURS_YESTERDAY,
  campaigns: CAMPAIGNS, campaignDays: CAMPAIGN_DAYS,
  campaignHours: CAMPAIGN_HOURS, campaignHoursYesterday: CAMPAIGN_HOURS_YESTERDAY,
  resolved: RESOLVED, recentOrders: RECENT_ORDERS,
  cash: CASH, gst: GST, fixedCostsMonthly: FIXED_COSTS_MONTHLY, sync: SYNC,
}
