import { supabase } from '@/lib/supabase'

export async function GET(request, context) {
  const { id } = await context.params

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('shopify_order_name', id)
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data)  return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(data)
}

export async function PATCH(request, context) {
  const { id } = await context.params
  const body = await request.json()

  const { order_date, payment_mode, status, order_value, delivered_at } = body

  const updates = { updated_at: new Date().toISOString() }
  if (order_date   !== undefined) updates.order_date    = order_date
  if (status       !== undefined) updates.status        = status
  if (order_value  !== undefined) updates.order_value   = parseFloat(order_value)
  if (delivered_at !== undefined) updates.delivered_at  = delivered_at

  // /api/pnl and /api/gst select delivered orders by delivered_at. An order
  // marked delivered without one drops out of every P&L month and GST return,
  // so backfill it here rather than trusting each caller to remember.
  if (status === 'delivered' && updates.delivered_at === undefined) {
    const { data: existing } = await supabase
      .from('orders')
      .select('delivered_at')
      .eq('shopify_order_name', id)
      .maybeSingle()
    if (!existing?.delivered_at) {
      const now = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      updates.delivered_at = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    }
  }

  // Leaving RTO/cancelled must clear a stale delivery date.
  if (status !== undefined && status !== 'delivered' && delivered_at === undefined) {
    updates.delivered_at = null
  }

  if (payment_mode !== undefined) {
    if (payment_mode === 'cod') updates.payment_type = 'cash_on_delivery'
    else if (payment_mode === 'razorpay' || payment_mode === 'prepaid_razorpay') updates.payment_type = 'prepaid_razorpay'
    else updates.payment_type = 'prepaid_cashfree'
  }

  const { data, error } = await supabase
    .from('orders')
    .update(updates)
    .eq('shopify_order_name', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function DELETE(request, context) {
  const { id } = await context.params

  const { error } = await supabase.from('orders').delete().eq('shopify_order_name', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
