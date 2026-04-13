import { supabase } from '@/lib/supabase'
import { computeMonthlyPnL } from '@/lib/pnl'

export async function POST(request) {
  const body = await request.json()
  const { month } = body // YYYY-MM

  if (!month) return Response.json({ error: 'month required' }, { status: 400 })

  const [y, m] = month.split('-').map(Number)
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const end = new Date(y, m, 0).toISOString().slice(0, 10)

  // Fetch orders for the month
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('*')
    .gte('order_date', start)
    .lte('order_date', end)

  if (ordersErr) return Response.json({ error: ordersErr.message }, { status: 500 })

  // Fetch ad spend for the month
  const { data: adSpend, error: adsErr } = await supabase
    .from('ad_spend')
    .select('spend')
    .gte('spend_date', start)
    .lte('spend_date', end)

  if (adsErr) return Response.json({ error: adsErr.message }, { status: 500 })

  // Fetch order items for COGS
  const orderIds = (orders || []).map((o) => o.id)
  let itemsMap = new Map()

  if (orderIds.length > 0) {
    const { data: items, error: itemsErr } = await supabase
      .from('order_items')
      .select('order_id, quantity, unit_cogs')
      .in('order_id', orderIds)

    if (itemsErr) return Response.json({ error: itemsErr.message }, { status: 500 })

    for (const item of items || []) {
      const prev = itemsMap.get(item.order_id) || { totalCogs: 0 }
      itemsMap.set(item.order_id, { totalCogs: prev.totalCogs + item.unit_cogs * item.quantity })
    }
  }

  const pnl = computeMonthlyPnL(orders || [], adSpend || [], itemsMap)

  const row = {
    month: start,
    ...pnl,
    computed_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('monthly_pnl')
    .upsert(row, { onConflict: 'month' })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
