import { supabase } from '@/lib/supabase'
import { computeOrderFees } from '@/lib/pnl'
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

  // Pre-fetch all referenced SKUs in one query to avoid N+1 calls
  const skus = [
    ...new Set(
      fulfilled.flatMap((o) =>
        (o.line_items || []).map((l) => l.sku).filter(Boolean)
      )
    ),
  ]
  const skuToId = new Map()
  if (skus.length > 0) {
    const { data: prods } = await supabase
      .from('products')
      .select('id, sku')
      .in('sku', skus)
    prods?.forEach((p) => skuToId.set(p.sku, p.id))
  }

  // Map to our DB schema
  const rows = fulfilled.map((o) => {
    const price = parseFloat(o.total_price) || 0
    const mode  = mapShopifyPaymentMode(o.payment_gateway)
    const fees  = computeOrderFees(price, mode)
    const sku   = (o.line_items || []).find((l) => l.sku)?.sku || null

    return {
      shopify_order_id:    o.name,                           // e.g. "#1001"
      order_date:          (o.created_at || '').slice(0, 10),
      payment_mode:        mode,
      status:              'delivered',
      selling_price:       price,
      checkout_fee:        fees.checkout,
      payment_gateway_fee: fees.paymentGw,
      inbound_fee:         0,
      delivery_charge:     0,
      packing_fee:         0,
      cod_handling_fee:    0,
      other_3pl_charges:   0,
      rto_charge:          0,
      product_id:          sku ? (skuToId.get(sku) || null) : null,
      notes:               `Auto-synced • Shopify ${o.name}`,
    }
  })

  const { error } = await supabase
    .from('orders')
    .upsert(rows, { onConflict: 'shopify_order_id' })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  await supabase.from('import_logs').insert([{
    import_type:  'orders',
    filename:     `shopify-auto-sync-${new Date().toISOString().slice(0, 10)}`,
    row_count:    rows.length,
    error_count:  0,
    errors:       null,
  }])

  return Response.json({ synced: rows.length, date: new Date().toISOString() })
}
