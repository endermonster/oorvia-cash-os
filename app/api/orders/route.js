import { supabase } from '@/lib/supabase'
import { computeOrderFees } from '@/lib/pnl'
import { selectAll } from '@/lib/paged'
import { monthRange } from '@/lib/dates'
import { ORDER_STATUS_LIST, PAYMENT_TYPE, PREPAID_TYPES, isValidOrderStatus } from '@/lib/constants'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const month       = searchParams.get('month') // YYYY-MM
  const status      = searchParams.get('status')
  const paymentMode = searchParams.get('paymentMode')

  // An unknown status used to fall through to `.eq()` and return an empty array,
  // which reads as "no orders" rather than "bad filter".
  if (status && !isValidOrderStatus(status)) {
    return Response.json(
      { error: `Unknown status '${status}'. Valid values: ${ORDER_STATUS_LIST.join(', ')}` },
      { status: 400 }
    )
  }

  // Callers (the ad-spend and RTO pages) total these rows, so the read must be
  // complete — an unbounded select truncates at the PostgREST row cap.
  try {
    const rows = await selectAll(() => {
      let q = supabase
        .from('orders')
        .select('*')
        .order('order_date', { ascending: false })

      if (month) {
        const { from, to } = monthRange(month)
        q = q.gte('order_date', from).lte('order_date', to)
      }
      if (status) q = q.eq('status', status)
      if (paymentMode === 'cod')          q = q.eq('payment_type', PAYMENT_TYPE.COD)
      else if (paymentMode === 'prepaid') q = q.in('payment_type', PREPAID_TYPES)

      return q
    })
    return Response.json(rows)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
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
