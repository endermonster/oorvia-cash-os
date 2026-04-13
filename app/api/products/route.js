import { supabase } from '@/lib/supabase'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const withMetrics = searchParams.get('withMetrics') === 'true'
  const month = searchParams.get('month') // YYYY-MM

  // Base product list
  const { data: products, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .order('name')

  if (error) return Response.json({ error: error.message }, { status: 500 })

  if (!withMetrics || !month) return Response.json(products)

  // Aggregate order_items for the month to compute per-product metrics
  const [y, m] = month.split('-').map(Number)
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const end = new Date(y, m, 0).toISOString().slice(0, 10)

  const { data: items, error: itemsErr } = await supabase
    .from('order_items')
    .select('product_id, quantity, unit_price, unit_cogs, orders!inner(order_date, status)')
    .gte('orders.order_date', start)
    .lte('orders.order_date', end)
    .neq('orders.status', 'rto')
    .neq('orders.status', 'cancelled')

  if (itemsErr) return Response.json({ error: itemsErr.message }, { status: 500 })

  // Aggregate by product_id
  const metricsMap = {}
  for (const item of items || []) {
    const pid = item.product_id
    if (!metricsMap[pid]) metricsMap[pid] = { units: 0, revenue: 0, cogs: 0 }
    metricsMap[pid].units += item.quantity
    metricsMap[pid].revenue += item.unit_price * item.quantity
    metricsMap[pid].cogs += item.unit_cogs * item.quantity
  }

  const result = products.map((p) => {
    const m = metricsMap[p.id] || { units: 0, revenue: 0, cogs: 0 }
    const grossMargin = m.revenue - m.cogs
    const marginPct = m.revenue > 0 ? (grossMargin / m.revenue) * 100 : 0
    return {
      ...p,
      units_sold: m.units,
      revenue: Math.round(m.revenue * 100) / 100,
      total_cogs: Math.round(m.cogs * 100) / 100,
      gross_margin: Math.round(grossMargin * 100) / 100,
      margin_pct: Math.round(marginPct * 10) / 10,
    }
  })

  return Response.json(result)
}

export async function POST(request) {
  const body = await request.json()
  const { name, sku, category, cogs, selling_price, weight_grams, gst_rate } = body

  const { data, error } = await supabase
    .from('products')
    .insert([{
      name,
      sku,
      category: category || null,
      cogs: parseFloat(cogs || 0),
      selling_price: parseFloat(selling_price || 0),
      weight_grams: weight_grams ? parseInt(weight_grams) : null,
      gst_rate: gst_rate !== undefined ? parseFloat(gst_rate) : 18,
    }])
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}

export async function PATCH(request) {
  const body = await request.json()
  const { id, name, sku, category, cogs, selling_price, weight_grams, is_active, gst_rate } = body

  const updates = {}
  if (name !== undefined) updates.name = name
  if (sku !== undefined) updates.sku = sku
  if (category !== undefined) updates.category = category || null
  if (cogs !== undefined) updates.cogs = parseFloat(cogs)
  if (selling_price !== undefined) updates.selling_price = parseFloat(selling_price)
  if (weight_grams !== undefined) updates.weight_grams = weight_grams ? parseInt(weight_grams) : null
  if (is_active !== undefined) updates.is_active = is_active
  if (gst_rate !== undefined) updates.gst_rate = parseFloat(gst_rate)

  const { data, error } = await supabase.from('products').update(updates).eq('id', id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function DELETE(request) {
  const { id } = await request.json()
  const { error } = await supabase.from('products').update({ is_active: false }).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
