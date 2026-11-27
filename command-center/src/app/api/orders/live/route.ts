import { allowedUser } from '@/lib/auth/server'

/**
 * The newest orders, for the live map on Home. Polled by the browser every ~20 s; the Shopify webhook is what
 * puts new rows in cc_orders, so a new order shows within one poll of Shopify sending it.
 *
 * NOT PUBLIC: proxy.ts gates it, and it checks the session itself too, so a matcher change cannot open it.
 */
export async function GET(req: Request) {
  if (!(await allowedUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  // ?from=YYYY-MM-DD&to=YYYY-MM-DD (IST dates): only orders placed in the period the page shows. Either missing or
  // malformed: the newest orders overall.
  const sp = new URL(req.url).searchParams
  const day = (k: string) => { const v = sp.get(k); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null }
  const from = day('from'), to = day('to')
  const range = from && to ? { from, to } : undefined
  if (process.env.DATA_SOURCE !== 'supabase') {
    const { MOCK } = await import('@/lib/mock')
    return Response.json({ source: 'mock', orders: MOCK.recentOrders }, { headers: { 'Cache-Control': 'no-store' } })
  }
  const { loadRecentOrders } = await import('@/lib/load')
  return Response.json({ source: 'supabase', orders: await loadRecentOrders(range) }, { headers: { 'Cache-Control': 'no-store' } })
}
