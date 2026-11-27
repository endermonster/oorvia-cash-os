/**
 * Everything the screen reads, in one object. `getData()` returns the in-memory
 * mock or the Supabase read; `createMetrics(data)` computes every figure from it.
 */
import { connection } from 'next/server'
import { SNAPSHOT_DAYS } from './metrics'
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
  /** Null unless loaded (Home only: src/lib/home-load.ts). */
  gst: GstPosition | null
  /** This month's VXP net profit and the owner's share, ₹, from the monthly P&L (as Money shows it). Null unless loaded (Home only); `share` null when stores' shares differ. */
  ownerShareMonth: { month: string; net: number; share: number | null } | null
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
  const { cachedChrome } = await import('./cached')
  // The request's own clock: pages date their forms and months from it, and the cached snapshot can be up to 60 s
  // old (yesterday, just after IST midnight). Its sync ages stay as of the snapshot.
  return { ...(await cachedChrome()), now: new Date() }
}

/** The snapshot under one cache key: Home's 70 and the other tabs' default are the same read. */
const historyKey = (n?: number) => (n === undefined || n <= SNAPSHOT_DAYS ? undefined : n)

/** `historyDays`: days of order and spend rows to read (default the 70-day snapshot); Home's long ranges ask for more. */
export async function getData(historyDays?: number): Promise<Data> {
  // Request-time data: under Cache Components this must run inside a <Suspense> boundary.
  await connection()
  await signedIn()
  if (process.env.DATA_SOURCE !== 'supabase') {
    const { MOCK } = await import('./mock')
    return MOCK
  }
  const [{ cachedData }, { istNow }] = await Promise.all([import('./cached'), import('./dates')])
  return cachedData(istNow(new Date()).today, historyKey(historyDays))
}

export async function getHomeData(historyDays?: number): Promise<Data> {
  await connection()
  await signedIn()
  if (process.env.DATA_SOURCE !== 'supabase') {
    const { MOCK } = await import('./mock')
    return MOCK
  }
  const [{ cachedData }, { loadHomeExtras }, { istNow }] = await Promise.all([import('./cached'), import('./home-load'), import('./dates')])
  // One IST day for both reads, so they agree even at midnight.
  const today = istNow(new Date()).today
  const [data, extras] = await Promise.all([cachedData(today, historyKey(historyDays)), loadHomeExtras(today)])
  return { ...data, ...extras }
}
