import { supabase } from '@/lib/supabase'
import { today } from '@/lib/dates'
import { ORDER_STATUS, ORDER_STATUS_LIST, PAYMENT_TYPE, isValidOrderStatus } from '@/lib/constants'

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

  if (status !== undefined && !isValidOrderStatus(status)) {
    return Response.json(
      { error: `Unknown status '${status}'. Valid values: ${ORDER_STATUS_LIST.join(', ')}` },
      { status: 400 }
    )
  }

  const updates = { updated_at: new Date().toISOString() }
  if (order_date   !== undefined) updates.order_date    = order_date
  if (status       !== undefined) updates.status        = status
  if (order_value  !== undefined) updates.order_value   = parseFloat(order_value)
  if (delivered_at !== undefined) updates.delivered_at  = delivered_at

  // /api/pnl and /api/gst select delivered orders by delivered_at. An order
  // marked delivered without one drops out of every P&L month and GST return,
  // so backfill it here rather than trusting each caller to remember.
  if (status === ORDER_STATUS.DELIVERED && updates.delivered_at === undefined) {
    const { data: existing } = await supabase
      .from('orders')
      .select('delivered_at')
      .eq('shopify_order_name', id)
      .maybeSingle()
    if (!existing?.delivered_at) {
      updates.delivered_at = today()
    }
  }

  // Leaving RTO/cancelled must clear a stale delivery date.
  if (status !== undefined && status !== ORDER_STATUS.DELIVERED && delivered_at === undefined) {
    updates.delivered_at = null
  }

  // No UI sends this any more — the order edit modal only corrects status and
  // delivered_at. Kept so an external caller using the `payment_mode` shorthand
  // still maps onto the real `payment_type` column.
  if (payment_mode !== undefined) {
    if (payment_mode === 'cod' || payment_mode === PAYMENT_TYPE.COD) updates.payment_type = PAYMENT_TYPE.COD
    else if (payment_mode === 'razorpay' || payment_mode === PAYMENT_TYPE.PREPAID_RAZORPAY) updates.payment_type = PAYMENT_TYPE.PREPAID_RAZORPAY
    else updates.payment_type = PAYMENT_TYPE.PREPAID_CASHFREE
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
