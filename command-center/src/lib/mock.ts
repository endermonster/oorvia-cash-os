/**
 * MOCK DATA. Deterministic, shaped like the real sources, so the screen can be
 * judged before any backend exists. Oorvia's delivery rate (84.8%) and COD share
 * (68%) are real (old Cash OS, Mar–Aug 2026); everything else is invented.
 */
import { breakeven } from './calculator'
import type {
  Campaign, CashPosition, DailyRow, GstPosition, HourlyRow, RecentOrder, Store, StoreId, SyncStatus,
} from './types'

/** The mock's fixed "now": 18 Nov 2026, 3:20 PM IST. */
export const NOW = new Date('2026-11-18T15:20:00+05:30')
export const TODAY = '2026-11-18'
export const NOW_HOUR = 15

export const STORES: Store[] = [
  {
    id: 'oorvia', name: 'Oorvia', liveSince: '2026-03-21',
    product: { name: 'Microinfusion System', price: 2299, cogs: 581, packedWeightGrams: 500 },
    deliveryRate: { value: 0.848, assumedFrom: null },
    codShare: { value: 0.68, assumedFrom: null },
    gateways: ['Cashfree', 'Razorpay'],
  },
  {
    id: 'kaiven', name: 'Kaiven', liveSince: '2026-11-10',
    product: { name: 'Deoxyribose Scalp Serum', price: 1499, cogs: 233, packedWeightGrams: 500 },
    deliveryRate: { value: 0.848, assumedFrom: 'oorvia' },
    codShare: { value: 0.68, assumedFrom: 'oorvia' },
    gateways: ['Razorpay', 'PayU'],
  },
  {
    id: 'selnova', name: 'Selnova', liveSince: '2026-11-13',
    product: { name: 'PDRN Ampoule', price: 1699, cogs: 350, packedWeightGrams: 500 },
    deliveryRate: { value: 0.848, assumedFrom: 'oorvia' },
    codShare: { value: 0.68, assumedFrom: 'oorvia' },
    gateways: ['Razorpay'],
  },
]

export const storeById = (id: StoreId) => STORES.find((s) => s.id === id)!

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

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

function buildDaily(): DailyRow[] {
  const rows: DailyRow[] = []
  for (const store of STORES) {
    const be = breakeven({ ...store.product, deliveryRate: store.deliveryRate.value, codShare: store.codShare.value })
    const rnd = mulberry32(store.id.length * 7919 + store.product.price)
    for (let date = '2026-09-15'; date <= TODAY; date = addDays(date, 1)) {
      const p = plan(store.id, date, rnd)
      const partial = date === TODAY ? SHARE_UNTIL_NOW : 1
      const spend = Math.round(p.spend * partial)
      const avgPaid = be.avgPricePaid
      // Near-deterministic so each store's story (above / below breakeven) survives small daily counts.
      const mean = (spend * be.breakevenRoas * p.roasMult) / avgPaid
      const paidOrders = spend > 0 ? Math.max(0, Math.round(mean + (rnd() - 0.5) * 0.9)) : 0
      const orders = paidOrders + poisson(p.organic * partial, rnd)
      let codOrders = 0
      for (let i = 0; i < orders; i++) if (rnd() < store.codShare.value) codOrders++
      const revenue = codOrders * store.product.price + (orders - codOrders) * (store.product.price - 100)
      const late = date >= '2026-11-15'
      const cpm = store.id === 'kaiven' && late ? 400 + rnd() * 40 : 320 + rnd() * 50
      const impressions = Math.round((spend / cpm) * 1000)
      const clicks = Math.round(impressions * (0.016 + rnd() * 0.005))
      const metaPurchases = Math.max(0, paidOrders - (rnd() < 0.25 ? 1 : 0))
      rows.push({ date, storeId: store.id, spend, impressions, clicks, metaPurchases, orders, codOrders, revenue })
    }
  }
  return rows
}

export const DAILY: DailyRow[] = buildDaily()

/** Today's rows split by hour, up to the current hour. */
function buildHourly(): HourlyRow[] {
  const rows: HourlyRow[] = []
  const w = HOUR_WEIGHTS.slice(0, NOW_HOUR + 1)
  const wSum = w.reduce((s, x) => s + x, 0)
  for (const d of DAILY.filter((r) => r.date === TODAY)) {
    const rnd = mulberry32(d.storeId.length * 31 + d.orders)
    const orderHours = Array.from({ length: d.orders }, () => {
      let x = rnd() * wSum
      for (let h = 0; h < w.length; h++) { x -= w[h]; if (x <= 0) return h }
      return NOW_HOUR
    })
    const codHours = orderHours.slice(0, d.codOrders)
    const price = storeById(d.storeId).product.price
    let spendLeft = d.spend
    for (let hour = 0; hour <= NOW_HOUR; hour++) {
      const share = w[hour] / wSum
      const orders = orderHours.filter((h) => h === hour).length
      const codOrders = codHours.filter((h) => h === hour).length
      const spend = hour === NOW_HOUR ? spendLeft : Math.round(d.spend * share)
      spendLeft -= spend
      rows.push({
        hour, storeId: d.storeId,
        spend,
        impressions: Math.round(d.impressions * share),
        clicks: Math.round(d.clicks * share),
        metaPurchases: orders,
        orders, codOrders,
        revenue: codOrders * price + (orders - codOrders) * (price - 100),
      })
    }
  }
  return rows
}

export const HOURLY_TODAY: HourlyRow[] = buildHourly()

export const CAMPAIGNS: Campaign[] = [
  { id: 'kv1', storeId: 'kaiven', name: 'Scalp – Broad', spendShare: 0.58, cpaFactor: 0.9 },
  { id: 'kv2', storeId: 'kaiven', name: 'Scalp – Hair fall 25–40', spendShare: 0.3, cpaFactor: 1.02 },
  { id: 'kv3', storeId: 'kaiven', name: 'DHS – Creative test', spendShare: 0.12, cpaFactor: 1.6 },
  { id: 'sn1', storeId: 'selnova', name: 'PDRN – Broad', spendShare: 0.64, cpaFactor: 0.94 },
  { id: 'sn2', storeId: 'selnova', name: 'PDRN – Glass skin 22–35', spendShare: 0.36, cpaFactor: 1.12 },
  { id: 'ov1', storeId: 'oorvia', name: 'MI – Broad (paused 10 Nov)', spendShare: 1, cpaFactor: 1 },
]

const CITIES = ['Bengaluru', 'Mumbai', 'Pune', 'Delhi', 'Hyderabad', 'Jaipur', 'Lucknow', 'Kochi', 'Indore', 'Chennai', 'Ahmedabad', 'Surat', 'Nagpur', 'Kolkata', 'Chandigarh']

function buildRecentOrders(): RecentOrder[] {
  const out: RecentOrder[] = []
  const rnd = mulberry32(4242)
  for (const h of HOURLY_TODAY) {
    const store = storeById(h.storeId)
    for (let i = 0; i < h.orders; i++) {
      const minute = h.hour === NOW_HOUR ? Math.floor(rnd() * 18) : Math.floor(rnd() * 60)
      const placed = new Date(`${TODAY}T${String(h.hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`)
      const payment = i < h.codOrders ? 'cod' : 'prepaid'
      out.push({
        id: `${store.id}-${h.hour}-${i}`,
        storeId: store.id,
        placedAt: placed.toISOString(),
        product: store.product.name,
        value: payment === 'cod' ? store.product.price : store.product.price - 100,
        payment,
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

export const SYNC: SyncStatus = { metaMinutesAgo: 4, shopifyMinutesAgo: 1, vfulfillImportDaysAgo: 4 }
