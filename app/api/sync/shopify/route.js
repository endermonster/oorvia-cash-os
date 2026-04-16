import { supabase } from '@/lib/supabase'
import { shouldImportShopifyOrder, mapShopifyPaymentMode } from '@/lib/shopify'

export async function POST(request) {
  const secret = process.env.SYNC_SECRET
  if (secret) {
    const auth = request.headers.get('authorization') || ''
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const rawOrders = body?.orders
  if (!Array.isArray(rawOrders) || rawOrders.length === 0) {
    return Response.json({ synced: 0, message: 'No orders in payload' })
  }

  // Drop everything that is not a completed sale (paid + fulfilled)
  const fulfilled = rawOrders.filter((o) =>
    shouldImportShopifyOrder(o.financial_status, o.fulfillment_status)
  )

  if (fulfilled.length === 0) {
    return Response.json({ synced: 0, message: 'No paid+fulfilled orders in payload' })
  }

  const rows = fulfilled.map((o) => ({
    shopify_order_id: o.name,
    order_date:       (o.created_at || '').slice(0, 10),
    payment_mode:     mapShopifyPaymentMode(o.payment_gateway),
    customer_state:   o.shipping_address?.province || null,
  }))

  const { error } = await supabase
    .from('orders')
    .upsert(rows, { onConflict: 'shopify_order_id' })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ synced: rows.length, date: new Date().toISOString() })
}
