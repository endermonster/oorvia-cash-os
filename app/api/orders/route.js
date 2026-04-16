import { supabase } from '@/lib/supabase'
import { computeOrderFees } from '@/lib/pnl'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const month       = searchParams.get('month') // YYYY-MM
  const status      = searchParams.get('status')
  const paymentMode = searchParams.get('paymentMode')

  let query = supabase
    .from('orders')
    .select('*')
    .order('order_date', { ascending: false })

  if (month) {
    const [y, m] = month.split('-').map(Number)
    const start = `${y}-${String(m).padStart(2, '0')}-01`
    const end   = new Date(y, m, 0).toISOString().slice(0, 10)
    query = query.gte('order_date', start).lte('order_date', end)
  }
  if (status)      query = query.eq('status', status)
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
    order_value,
    order_mgmt_fee       = 0,
    platform_fee         = 0,
    cod_fee              = 0,
    forward_shipping_fee = 0,
    fulfillment_fee      = 0,
    rto_fee              = 0,
    meta_ad_spend_attributed,
    notes,
    // optional overrides; auto-computed if not provided
    checkout_fee,
    cashfree_fee,
  } = body

  const price = parseFloat(order_value)
  const fees  = computeOrderFees(price, payment_mode)

  const row = {
    shopify_order_id: shopify_order_id || null,
    order_date,
    payment_mode,
    status,
    order_value:      price,
    checkout_fee:     checkout_fee  !== undefined ? parseFloat(checkout_fee)  : fees.checkout,
    cashfree_fee:     cashfree_fee  !== undefined ? parseFloat(cashfree_fee)  : fees.cashfreeFee,
    order_mgmt_fee:       parseFloat(order_mgmt_fee),
    platform_fee:         parseFloat(platform_fee),
    cod_fee:              parseFloat(cod_fee),
    forward_shipping_fee: parseFloat(forward_shipping_fee),
    fulfillment_fee:      parseFloat(fulfillment_fee),
    rto_fee:              parseFloat(rto_fee),
    meta_ad_spend_attributed: meta_ad_spend_attributed ? parseFloat(meta_ad_spend_attributed) : null,
    notes: notes || null,
  }

  const { data, error } = await supabase.from('orders').insert([row]).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}
