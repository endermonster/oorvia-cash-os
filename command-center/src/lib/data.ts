/**
 * Everything the screen reads, in one object. `getData()` returns the in-memory
 * mock or the Supabase read; `createMetrics(data)` computes every figure from it.
 */
import { connection } from 'next/server'
import type {
  Campaign, CampaignDay, CampaignHour, CashPosition, GstPosition, OrderDay, OrderHour, Product, RecentOrder, ResolvedDay,
  Store, SyncStatus,
} from './types'

export type Data = {
  now: Date
  /** YYYY-MM-DD, IST. */
  today: string
  /** 0-23, IST. */
  nowHour: number
  /** 0-59, IST. */
  nowMinute: number
  source: 'mock' | 'supabase'
  stores: Store[]
  products: Product[]
  orders: OrderDay[]
  /** Today's order rows by hour. */
  orderHours: OrderHour[]
  /** All 24 hours of yesterday. */
  orderHoursYesterday: OrderHour[]
  campaigns: Campaign[]
  campaignDays: CampaignDay[]
  /** Today's campaign rows by hour. */
  campaignHours: CampaignHour[]
  campaignHoursYesterday: CampaignHour[]
  resolved: ResolvedDay[]
  recentOrders: RecentOrder[]
  /** Null until the cash sources are wired. */
  cash: CashPosition | null
  gst: GstPosition | null
  fixedCostsMonthly: number | null
  /** ₹ per month, ex-GST: recurring fixed costs running today, every store and shared (pnl.monthlyRunRate). Drives VXP's breakeven only. Null when none are on record. */
  fixedCostsRunRate: number | null
  sync: SyncStatus
}

/** What the top bar needs on every page, including the placeholder tabs: no figures. */
export type Chrome = Pick<Data, 'now' | 'source' | 'stores' | 'sync'>

/** No figures, mock or real, without an allowed session: the line behind proxy.ts (redirects to /login). */
async function signedIn() {
  const { requireUser } = await import('./auth/server')
  await requireUser()
}

/** Light read for pages that show no figures: the store list and sync status only. */
export async function getChrome(): Promise<Chrome> {
  await connection()
  await signedIn()
  if (process.env.DATA_SOURCE !== 'supabase') {
    const { MOCK } = await import('./mock')
    return MOCK
  }
  const { loadChrome } = await import('./load')
  return loadChrome()
}

export async function getData(): Promise<Data> {
  // Request-time data: under Cache Components this must run inside a <Suspense> boundary.
  await connection()
  await signedIn()
  if (process.env.DATA_SOURCE !== 'supabase') {
    const { MOCK } = await import('./mock')
    return MOCK
  }
  const { loadData } = await import('./load')
  return loadData()
}
