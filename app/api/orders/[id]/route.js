import { supabase } from '@/lib/supabase'
import { computeOrderFees } from '@/lib/pnl'

export async function GET(request, context) {
  const { id } = await context.params

  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data)  return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(data)
}

export async function PATCH(request, context) {
  const { id } = await context.params
  const body = await request.json()

  const {
    shopify_order_id,
    order_date,
    payment_mode,
    status,
    order_value,
    order_mgmt_fee,
    platform_fee,
    cod_fee,
    forward_shipping_fee,
    fulfillment_fee,
    rto_fee,
    checkout_fee,
    cashfree_fee,
    meta_ad_spend_attributed,
    notes,
  } = body

  const updates = { updated_at: new Date().toISOString() }

  if (shopify_order_id          !== undefined) updates.shopify_order_id          = shopify_order_id || null
  if (order_date                !== undefined) updates.order_date                = order_date
  if (status                    !== undefined) updates.status                    = status
  if (order_mgmt_fee            !== undefined) updates.order_mgmt_fee            = parseFloat(order_mgmt_fee)
  if (platform_fee              !== undefined) updates.platform_fee              = parseFloat(platform_fee)
  if (cod_fee                   !== undefined) updates.cod_fee                   = parseFloat(cod_fee)
  if (forward_shipping_fee      !== undefined) updates.forward_shipping_fee      = parseFloat(forward_shipping_fee)
  if (fulfillment_fee           !== undefined) updates.fulfillment_fee           = parseFloat(fulfillment_fee)
  if (rto_fee                   !== undefined) updates.rto_fee                   = parseFloat(rto_fee)
  if (notes                     !== undefined) updates.notes                     = notes || null
  if (meta_ad_spend_attributed  !== undefined)
    updates.meta_ad_spend_attributed = meta_ad_spend_attributed ? parseFloat(meta_ad_spend_attributed) : null

  // If order_value or payment_mode changes, recompute derived fees unless overridden
  if (order_value !== undefined || payment_mode !== undefined) {
    const { data: current } = await supabase
      .from('orders')
      .select('order_value, payment_mode')
      .eq('id', id)
      .single()

    const newValue = order_value   !== undefined ? parseFloat(order_value)  : current?.order_value
    const newMode  = payment_mode  !== undefined ? payment_mode              : current?.payment_mode

    updates.order_value  = newValue
    updates.payment_mode = newMode

    const fees = computeOrderFees(newValue, newMode)
    updates.checkout_fee  = checkout_fee  !== undefined ? parseFloat(checkout_fee)  : fees.checkout
    updates.cashfree_fee  = cashfree_fee  !== undefined ? parseFloat(cashfree_fee)  : fees.cashfreeFee
  } else {
    if (checkout_fee !== undefined) updates.checkout_fee = parseFloat(checkout_fee)
    if (cashfree_fee !== undefined) updates.cashfree_fee = parseFloat(cashfree_fee)
  }

  const { data, error } = await supabase
    .from('orders')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function DELETE(request, context) {
  const { id } = await context.params

  const { error } = await supabase.from('orders').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
