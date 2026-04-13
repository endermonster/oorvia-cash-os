import { supabase } from '@/lib/supabase'
import { computeOrderFees } from '@/lib/pnl'

// Map Shopify financial_status + fulfillment_status → our status enum
function mapStatus(financial, fulfillment) {
  if (financial === 'refunded') return 'rto'
  if (financial === 'voided') return 'cancelled'
  if (fulfillment === 'fulfilled') return 'delivered'
  if (fulfillment === 'partial') return 'shipped'
  if (financial === 'paid') return 'shipped'
  return 'pending'
}

// Detect COD from Shopify payment gateway string
function mapPaymentMode(gateway) {
  const g = (gateway || '').toLowerCase().replace(/[\s_-]/g, '')
  if (g.includes('cod') || g.includes('cashondelivery') || g === 'manual') return 'cod'
  return 'prepaid'
}

export async function POST(request) {
  // Simple shared-secret auth — set SYNC_SECRET in .env.local
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

  // Pre-fetch all referenced SKUs in one query to avoid N+1 calls
  const skus = [
    ...new Set(
      rawOrders.flatMap((o) =>
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

  // Map raw Shopify orders → our DB schema
  const rows = rawOrders
    .filter((o) => o.id && o.created_at && o.total_price != null)
    .map((o) => {
      const price = parseFloat(o.total_price) || 0
      const mode = mapPaymentMode(o.payment_gateway)
      const fees = computeOrderFees(price, mode)
      const sku = (o.line_items || []).find((l) => l.sku)?.sku || null

      return {
        shopify_order_id: String(o.id),
        order_date: o.created_at.slice(0, 10),
        payment_mode: mode,
        status: mapStatus(o.financial_status, o.fulfillment_status),
        selling_price: price,
        checkout_fee: fees.checkout,
        payment_gateway_fee: fees.paymentGw,
        // 3PL charges come from vfulfill — left at 0, update manually or via separate sync
        inbound_fee: 0,
        delivery_charge: 0,
        packing_fee: 0,
        cod_handling_fee: 0,
        other_3pl_charges: 0,
        rto_charge: 0,
        product_id: sku ? (skuToId.get(sku) || null) : null,
        notes: `Auto-synced • Shopify ${o.name}`,
      }
    })

  if (rows.length === 0) {
    return Response.json({
      synced: 0,
      message: 'All orders skipped (missing id / created_at / total_price)',
    })
  }

  // Upsert on shopify_order_id so re-running is safe and status updates propagate
  // Requires: ALTER TABLE orders ADD CONSTRAINT orders_shopify_order_id_key UNIQUE (shopify_order_id);
  const { error } = await supabase
    .from('orders')
    .upsert(rows, { onConflict: 'shopify_order_id' })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  await supabase.from('import_logs').insert([{
    import_type: 'orders',
    filename: `shopify-auto-sync-${new Date().toISOString().slice(0, 10)}`,
    row_count: rows.length,
    error_count: 0,
    errors: null,
  }])

  return Response.json({
    synced: rows.length,
    date: new Date().toISOString(),
  })
}
