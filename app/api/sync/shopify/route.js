import { supabase } from '@/lib/supabase'
import { mapShopifyStatus } from '@/lib/shopify'

function r2(n) { return Math.round(n * 100) / 100 }

function mapPaymentType(gateway) {
  const v = (gateway || '').toLowerCase().replace(/[\s_-]/g, '')
  if (v.includes('cod') || v.includes('cashondelivery') || v === 'manual') return 'cash_on_delivery'
  if (v.includes('cashfree')) return 'prepaid_cashfree'
  if (v.includes('razorpay')) return 'prepaid_razorpay'
  return 'unknown'
}

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

  const orderMap = new Map()
  for (const o of rawOrders) {
    const name       = o.name
    if (!name) continue

    const gateway    = o.payment_gateway || ''
    const orderValue = parseFloat(o.total_price) || 0
    const orderDate  = (o.created_at || '').slice(0, 10)
    const shipState  = o.shipping_address?.province || null
    const status     = mapShopifyStatus(o.financial_status, o.fulfillment_status, o.cancelled_at)

    const lineItems = (o.line_items || [])
      .filter((li) => li.sku || li.title)
      .map((li) => ({
        shopify_order_name: name,
        sku:        li.sku?.trim() || null,
        qty:        li.quantity || 1,
        unit_price: r2(parseFloat(li.price) || 0),
      }))

    orderMap.set(name, {
      order: {
        shopify_order_name: name,
        payment_type:       mapPaymentType(gateway),
        order_value:        r2(orderValue),
        order_date:         orderDate,
        status,
        ship_state:         shipState,
      },
      lineItems,
      checkoutCost: {
        shopify_order_name: name,
        transaction_head:   'Checkout Service Fee',
        taxable_amt:        r2(orderValue * 0.02),
        gst_amt:            r2(orderValue * 0.02 * 0.18),
        total_amt:          r2(orderValue * 0.0236),
        transaction_date:   orderDate,
        nature:             'debit',
        source:             'fastrr',
      },
    })
  }

  if (orderMap.size === 0) {
    return Response.json({ synced: 0, message: 'No valid orders in payload' })
  }

  const orderNames   = [...orderMap.keys()]
  const allOrderRows = [...orderMap.values()].map((v) => v.order)
  const allLineItems = [...orderMap.values()].flatMap((v) => v.lineItems)
  const allCosts     = [...orderMap.values()].map((v) => v.checkoutCost)
  const errors       = []

  // Fetch existing orders + their current status
  const { data: existingRows, error: fetchErr } = await supabase
    .from('orders')
    .select('shopify_order_name, status')
    .in('shopify_order_name', orderNames)
  if (fetchErr) return Response.json({ error: fetchErr.message }, { status: 500 })

  const existingMap = new Map((existingRows || []).map((o) => [o.shopify_order_name, o.status]))
  const newOrders   = allOrderRows.filter((o) => !existingMap.has(o.shopify_order_name))
  const oldOrders   = allOrderRows.filter((o) =>  existingMap.has(o.shopify_order_name))

  if (newOrders.length > 0) {
    const { error } = await supabase.from('orders').insert(newOrders)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  for (const o of oldOrders) {
    const currentStatus = existingMap.get(o.shopify_order_name)
    // Never downgrade from 'delivered' — that status is set by vFulfill, Shopify doesn't know about it
    const newStatus = currentStatus === 'delivered' ? 'delivered' : o.status

    const { error } = await supabase
      .from('orders')
      .update({
        payment_type: o.payment_type,
        order_value:  o.order_value,
        order_date:   o.order_date,
        ship_state:   o.ship_state,
        status:       newStatus,
      })
      .eq('shopify_order_name', o.shopify_order_name)
    if (error) errors.push({ order: o.shopify_order_name, message: error.message })
  }

  // Replace line items
  const { error: delLiErr } = await supabase
    .from('order_line_items')
    .delete()
    .in('shopify_order_name', orderNames)
  if (delLiErr) errors.push({ row: 'line_items_delete', message: delLiErr.message })

  if (allLineItems.length > 0) {
    const uniqueSkus = [...new Set(allLineItems.map((li) => li.sku).filter(Boolean))]
    if (uniqueSkus.length > 0) {
      const { data: existingProducts } = await supabase
        .from('products').select('sku').in('sku', uniqueSkus)
      const existingSkuSet = new Set((existingProducts || []).map((p) => p.sku))
      const missingSkus = uniqueSkus.filter((s) => !existingSkuSet.has(s))
      if (missingSkus.length > 0) {
        const { error: stubErr } = await supabase
          .from('products')
          .insert(missingSkus.map((sku) => ({ sku, name: sku, current_cogs: 0 })))
        if (stubErr) errors.push({ row: 'products_stub', message: stubErr.message })
      }
    }

    const { error } = await supabase.from('order_line_items').insert(allLineItems)
    if (error) errors.push({ row: 'line_items_insert', message: error.message })
  }

  // Replace Fastrr checkout costs
  const { error: delCostErr } = await supabase
    .from('order_costs')
    .delete()
    .in('shopify_order_name', orderNames)
    .eq('source', 'fastrr')
  if (delCostErr) errors.push({ row: 'order_costs_delete', message: delCostErr.message })

  const { error: costsErr } = await supabase.from('order_costs').insert(allCosts)
  if (costsErr) errors.push({ row: 'order_costs_insert', message: costsErr.message })

  const byStatus = allOrderRows.reduce((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1
    return acc
  }, {})

  return Response.json({
    synced:             orderNames.length,
    inserted:           newOrders.length,
    updated:            oldOrders.length,
    by_status:          byStatus,
    line_items_created: allLineItems.length,
    errors,
    date:               new Date().toISOString(),
  })
}
