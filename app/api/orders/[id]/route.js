import { supabase } from '@/lib/supabase'
import { computeOrderFees } from '@/lib/pnl'

export async function GET(request, context) {
  const { id } = await context.params

  const { data, error } = await supabase
    .from('orders')
    .select('*, products(name, sku), order_items(*, products(name, sku))')
    .eq('id', id)
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
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
    selling_price,
    checkout_fee,
    payment_gateway_fee,
    inbound_fee,
    delivery_charge,
    packing_fee,
    cod_handling_fee,
    other_3pl_charges,
    rto_charge,
    meta_ad_spend_attributed,
    settlement_date,
    settled_to_wallet,
    settled_to_bank,
    product_id,
    notes,
  } = body

  const updates = { updated_at: new Date().toISOString() }

  if (shopify_order_id !== undefined) updates.shopify_order_id = shopify_order_id || null
  if (order_date !== undefined) updates.order_date = order_date
  if (status !== undefined) updates.status = status
  if (settlement_date !== undefined) updates.settlement_date = settlement_date || null
  if (settled_to_wallet !== undefined) updates.settled_to_wallet = settled_to_wallet
  if (settled_to_bank !== undefined) updates.settled_to_bank = settled_to_bank
  if (product_id !== undefined) updates.product_id = product_id || null
  if (notes !== undefined) updates.notes = notes || null
  if (meta_ad_spend_attributed !== undefined)
    updates.meta_ad_spend_attributed = meta_ad_spend_attributed ? parseFloat(meta_ad_spend_attributed) : null
  if (inbound_fee !== undefined) updates.inbound_fee = parseFloat(inbound_fee)
  if (delivery_charge !== undefined) updates.delivery_charge = parseFloat(delivery_charge)
  if (packing_fee !== undefined) updates.packing_fee = parseFloat(packing_fee)
  if (cod_handling_fee !== undefined) updates.cod_handling_fee = parseFloat(cod_handling_fee)
  if (other_3pl_charges !== undefined) updates.other_3pl_charges = parseFloat(other_3pl_charges)
  if (rto_charge !== undefined) updates.rto_charge = parseFloat(rto_charge)

  // If selling_price or payment_mode changes, recompute platform fees (unless explicit overrides)
  if (selling_price !== undefined || payment_mode !== undefined) {
    // Fetch current row to fill missing values
    const { data: current } = await supabase.from('orders').select('selling_price,payment_mode').eq('id', id).single()
    const newPrice = selling_price !== undefined ? parseFloat(selling_price) : current?.selling_price
    const newMode = payment_mode !== undefined ? payment_mode : current?.payment_mode

    updates.selling_price = newPrice
    updates.payment_mode = newMode

    if (checkout_fee !== undefined) {
      updates.checkout_fee = parseFloat(checkout_fee)
    } else {
      updates.checkout_fee = computeOrderFees(newPrice, newMode).checkout
    }
    if (payment_gateway_fee !== undefined) {
      updates.payment_gateway_fee = parseFloat(payment_gateway_fee)
    } else {
      updates.payment_gateway_fee = computeOrderFees(newPrice, newMode).paymentGw
    }
  } else {
    if (checkout_fee !== undefined) updates.checkout_fee = parseFloat(checkout_fee)
    if (payment_gateway_fee !== undefined) updates.payment_gateway_fee = parseFloat(payment_gateway_fee)
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
