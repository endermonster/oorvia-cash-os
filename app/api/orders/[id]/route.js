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

  const { order_date, payment_mode, status, order_value } = body

  const updates = { updated_at: new Date().toISOString() }
  if (order_date   !== undefined) updates.order_date    = order_date
  if (status       !== undefined) updates.status        = status
  if (order_value  !== undefined) updates.order_value   = parseFloat(order_value)
  if (payment_mode !== undefined) {
    updates.payment_type = payment_mode === 'cod' ? 'cash_on_delivery' : 'prepaid_cashfree'
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
