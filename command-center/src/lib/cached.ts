import 'server-only'
import { cacheLife, cacheTag, revalidateTag } from 'next/cache'
import type { Product, StoreId } from './types'

/**
 * The pages' reads, cached so a store or period switch does not reload everything from Supabase. Shared across
 * server instances ('use cache: remote') and keyed by the arguments, so a new IST day starts new entries.
 *
 * Fresh for 30 s, served stale while it refreshes up to 60 s, never older than that. Anything this app writes drops
 * it at once (invalidateData, updateTag): the Shopify webhook, Meta syncs, the funds check and every /settings save. Writes from
 * outside the app (scripts, the Supabase dashboard) show within 60 s.
 *
 * Callers check the session first: nothing here reads cookies, and nothing here may be reached without that check.
 * Uncached reads stay where freshness matters more than speed: /settings, the live map and the owner-share API.
 */
export const DATA_TAG = 'cc-data'

/** After a write in a route handler (webhook, cron, sync): the next page load reads fresh, never stale. Server Actions use updateTag(DATA_TAG). */
export function invalidateData() {
  revalidateTag(DATA_TAG, { expire: 0 })
}

function fresh() {
  cacheLife({ stale: 30, revalidate: 30, expire: 60 })
  cacheTag(DATA_TAG)
}

export async function cachedChrome() {
  'use cache: remote'
  fresh()
  const { loadChrome } = await import('./load')
  return loadChrome()
}

/**
 * The snapshot for IST day `today`, taken now. If the clock has crossed midnight since the caller read `today`, it is
 * taken as of the last moment of `today`, so it agrees with the reads the caller made for that day (Home's extras).
 */
export async function cachedData(today: string, historyDays?: number) {
  'use cache: remote'
  fresh()
  const [{ loadData }, { istNow }] = await Promise.all([import('./load'), import('./dates')])
  const now = new Date()
  return loadData(istNow(now).today === today ? now : new Date(`${today}T23:59:59.999+05:30`), historyDays)
}

export async function cachedPnl(fromMonth: string, toMonth: string, asOf?: string) {
  'use cache: remote'
  fresh()
  const { loadPnl } = await import('./pnl-load')
  return loadPnl(fromMonth, toMonth, asOf)
}

export async function cachedGst(today: string) {
  'use cache: remote'
  fresh()
  const { loadGst } = await import('./gst-load')
  return loadGst(today)
}

export async function cachedCapital(today: string) {
  'use cache: remote'
  fresh()
  const { loadCapital } = await import('./gst-load')
  return loadCapital(today)
}

export async function cachedBaselines() {
  'use cache: remote'
  fresh()
  const { loadBaselines } = await import('./pnl-load')
  return loadBaselines()
}

export async function cachedAds(from: string, to: string, storeIds: StoreId[], products: Pick<Product, 'storeId' | 'sku' | 'handle'>[]) {
  'use cache: remote'
  fresh()
  const { loadAds } = await import('./ads-load')
  return loadAds(from, to, storeIds, products)
}

export async function cachedOrdersMonth(month: string, storeIds: string[]) {
  'use cache: remote'
  fresh()
  const { loadOrdersMonth } = await import('./orders-load')
  return loadOrdersMonth(month, storeIds)
}
