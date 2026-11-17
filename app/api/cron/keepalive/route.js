import { supabase } from '@/lib/supabase'

// Daily Vercel Cron (vercel.json). Supabase pauses a free project after about a
// week with no activity; one real query a day keeps it awake. Vercel sends
// `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set on the project.
export async function GET(request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'CRON_SECRET is not set' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { count, error } = await supabase
    .from('orders')
    .select('shopify_order_name', { count: 'exact', head: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true, orders: count })
}
