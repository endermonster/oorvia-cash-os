import { allowedUser } from '@/lib/auth/server'

/**
 * The newest orders, for the live map on Home. Polled by the browser every ~20 s; the Shopify webhook is what
 * puts new rows in cc_orders, so a new order shows within one poll of Shopify sending it.
 *
 * NOT PUBLIC: proxy.ts gates it, and it checks the session itself too, so a matcher change cannot open it.
 */
export async function GET() {
  if (!(await allowedUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (process.env.DATA_SOURCE !== 'supabase') {
    const { MOCK } = await import('@/lib/mock')
    return Response.json({ source: 'mock', orders: MOCK.recentOrders }, { headers: { 'Cache-Control': 'no-store' } })
  }
  const { loadRecentOrders } = await import('@/lib/load')
  return Response.json({ source: 'supabase', orders: await loadRecentOrders() }, { headers: { 'Cache-Control': 'no-store' } })
}
