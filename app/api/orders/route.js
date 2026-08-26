import { supabase } from '@/lib/supabase'
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

// POST removed. Orders are created only by /api/sync/shopify and
// /api/import/vfulfill. The old handler wrote shopify_order_id, payment_mode,
// checkout_fee, cod_fee and six other columns that do not exist on `orders`
// (PK is shopify_order_name, the column is payment_type), so every call 500'd.
// Status corrections go through PATCH /api/orders/[id].
