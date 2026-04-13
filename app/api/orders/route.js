import { supabase } from '@/lib/supabase'
import { computeOrderFees } from '@/lib/pnl'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month') // YYYY-MM
  const status = searchParams.get('status')
  const paymentMode = searchParams.get('paymentMode')

  let query = supabase
    .from('orders')
    .select('*, products(name, sku)')
    .order('order_date', { ascending: false })

  if (month) {
    const [y, m] = month.split('-').map(Number)
    const start = `${y}-${String(m).padStart(2, '0')}-01`
    const end = new Date(y, m, 0).toISOString().slice(0, 10) // last day of month
    query = query.gte('order_date', start).lte('order_date', end)
  }
  if (status) query = query.eq('status', status)
  if (paymentMode) query = query.eq('payment_mode', paymentMode)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(request) {
  const body = await request.json()
  const {
    shopify_order_id,
    order_date,
    payment_mode,
    status = 'pending',
    selling_price,
    inbound_fee = 0,
    delivery_charge = 0,
    packing_fee = 0,
    cod_handling_fee = 0,
    other_3pl_charges = 0,
    rto_charge = 0,
    meta_ad_spend_attributed,
    settlement_date,
    settled_to_wallet = false,
    settled_to_bank = false,
    product_id,
    notes,
    // optional fee overrides; if not provided, auto-compute
    checkout_fee,
    payment_gateway_fee,
  } = body

  const price = parseFloat(selling_price)
  const fees = computeOrderFees(price, payment_mode)

  const row = {
    shopify_order_id: shopify_order_id || null,
    order_date,
    payment_mode,
    status,
    selling_price: price,
    checkout_fee: checkout_fee !== undefined ? parseFloat(checkout_fee) : fees.checkout,
    payment_gateway_fee:
      payment_gateway_fee !== undefined ? parseFloat(payment_gateway_fee) : fees.paymentGw,
    inbound_fee: parseFloat(inbound_fee),
    delivery_charge: parseFloat(delivery_charge),
    packing_fee: parseFloat(packing_fee),
    cod_handling_fee: parseFloat(cod_handling_fee),
    other_3pl_charges: parseFloat(other_3pl_charges),
    rto_charge: parseFloat(rto_charge),
    meta_ad_spend_attributed: meta_ad_spend_attributed ? parseFloat(meta_ad_spend_attributed) : null,
    settlement_date: settlement_date || null,
    settled_to_wallet,
    settled_to_bank,
    product_id: product_id || null,
    notes: notes || null,
  }

  const { data, error } = await supabase.from('orders').insert([row]).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}
