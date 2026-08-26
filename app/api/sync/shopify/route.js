import { supabase } from '@/lib/supabase'
import { mapShopifyStatus, mapShopifyPaymentMode } from '@/lib/shopify'
import { selectAllIn } from '@/lib/paged'
import {
  ORDER_STATUS,
  PAYMENT_TYPE,
  CASHFREE_FEE_RATE,
  GST_RATE_PCT,
  COST_SOURCE,
} from '@/lib/constants'

function r2(n) { return Math.round(n * 100) / 100 }

// RPC payloads travel in the POST body, so the limit is statement size rather
// than URL length. Each chunk is one atomic delete+insert inside the function.
const RPC_CHUNK   = 200
// PostgREST builds a single statement per write request — keep batches bounded.
const WRITE_CHUNK = 400

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function POST(request) {
  const secret = process.env.SYNC_SECRET
  if (secret) {
    const auth = request.headers.get('authorization') || ''
    const keyParam = new URL(request.url).searchParams.get('key') || ''
    if (auth !== `Bearer ${secret}` && keyParam !== secret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Accept { orders: [...] } (bulk) or a single Shopify order object at root (webhook)
  let rawOrders
  if (Array.isArray(body?.orders)) {
    rawOrders = body.orders
  } else if (body?.name || body?.id) {
    rawOrders = [body]
  } else {
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
    const paymentType = mapShopifyPaymentMode(gateway)

    const lineItems = (o.line_items || [])
      .filter((li) => li.sku || li.title)
      .map((li) => ({
        shopify_order_name: name,
        sku:        li.sku?.trim() || null,
        qty:        li.quantity || 1,
        unit_price: r2(parseFloat(li.price) || 0),
      }))

    // Cashfree charges 2.5% + 18% GST on the fee, prepaid only. Nothing else
    // writes this row, so without it the fee is missing from cost and its GST
    // input credit is never claimed.
    let cashfreeCost = null
    if (paymentType === PAYMENT_TYPE.PREPAID_CASHFREE && orderValue > 0) {
      const taxable = r2(orderValue * CASHFREE_FEE_RATE)
      const gst     = r2(taxable * GST_RATE_PCT / 100)
      cashfreeCost = {
        shopify_order_name: name,
        transaction_head:   'Payment Gateway Fee',
        taxable_amt:        taxable,
        gst_amt:            gst,
        total_amt:          r2(taxable + gst),
        transaction_date:   orderDate,
        nature:             'debit',
        source:             COST_SOURCE.CASHFREE,
      }
    }

    orderMap.set(name, {
      order: {
        shopify_order_name: name,
        payment_type:       paymentType,
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
        source:             COST_SOURCE.FASTRR,
      },
      cashfreeCost,
    })
  }

  if (orderMap.size === 0) {
    return Response.json({ synced: 0, message: 'No valid orders in payload' })
  }

  const orderNames    = [...orderMap.keys()]
  const allOrderRows  = [...orderMap.values()].map((v) => v.order)
  const allLineItems  = [...orderMap.values()].flatMap((v) => v.lineItems)
  const checkoutCosts = [...orderMap.values()].map((v) => v.checkoutCost)
  const cashfreeCosts = [...orderMap.values()].map((v) => v.cashfreeCost).filter(Boolean)
  const errors        = []

  // Fetch existing orders + their current status. Chunked: an unbounded .in()
  // is truncated at 1000 rows, which makes existing orders look new — they then
  // collide on the primary key and abort the whole batch.
  let existingRows
  try {
    existingRows = await selectAllIn(
      (names) => supabase.from('orders').select('shopify_order_name, status').in('shopify_order_name', names),
      orderNames
    )
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }

  const existingMap   = new Map(existingRows.map((o) => [o.shopify_order_name, o.status]))
  const insertedCount = allOrderRows.filter((o) => !existingMap.has(o.shopify_order_name)).length
  const updatedCount  = allOrderRows.length - insertedCount

  // Never downgrade from 'delivered' — that status is set by vFulfill, Shopify
  // doesn't know about it. Resolved before the write so the upsert carries the
  // same status the per-order update used to compute.
  const upsertRows = allOrderRows.map((o) => ({
    ...o,
    status: existingMap.get(o.shopify_order_name) === ORDER_STATUS.DELIVERED
      ? ORDER_STATUS.DELIVERED
      : o.status,
  }))

  for (const batch of chunk(upsertRows, WRITE_CHUNK)) {
    const { error } = await supabase
      .from('orders')
      .upsert(batch, { onConflict: 'shopify_order_name' })
    if (!error) continue
    // Retry row by row so one bad order can't drop the rest of the batch
    for (const row of batch) {
      const { error: rowErr } = await supabase
        .from('orders')
        .upsert(row, { onConflict: 'shopify_order_name' })
      if (rowErr) errors.push({ order: row.shopify_order_name, message: rowErr.message })
    }
  }

  // Stub any SKUs we've never seen, so the line item rows have something to
  // point at. ON CONFLICT DO NOTHING — never reset an existing product's COGS.
  if (allLineItems.length > 0) {
    const uniqueSkus = [...new Set(allLineItems.map((li) => li.sku).filter(Boolean))]
    if (uniqueSkus.length > 0) {
      let existingProducts = []
      try {
        existingProducts = await selectAllIn(
          (skus) => supabase.from('products').select('sku').in('sku', skus),
          uniqueSkus
        )
      } catch (e) {
        errors.push({ row: 'products_lookup', message: e.message })
      }
      const existingSkuSet = new Set(existingProducts.map((p) => p.sku))
      const missingSkus = uniqueSkus.filter((s) => !existingSkuSet.has(s))
      for (const batch of chunk(missingSkus, WRITE_CHUNK)) {
        const { error: stubErr } = await supabase
          .from('products')
          .upsert(
            batch.map((sku) => ({ sku, name: sku, current_cogs: 0 })),
            { onConflict: 'sku', ignoreDuplicates: true }
          )
        if (stubErr) errors.push({ row: 'products_stub', message: stubErr.message })
      }
    }
  }

  // Replace line items — the delete and the insert share one transaction inside
  // replace_order_line_items(). A failed insert used to leave the orders with no
  // line items at all, which silently zeroes their COGS.
  // Called even when there are no line items: the delete still has to run.
  let lineItemsWritten = 0
  for (const names of chunk(orderNames, RPC_CHUNK)) {
    const inChunk = new Set(names)
    const { data, error } = await supabase.rpc('replace_order_line_items', {
      p_order_names: names,
      p_rows:        allLineItems.filter((li) => inChunk.has(li.shopify_order_name)),
    })
    if (error) errors.push({ row: 'line_items_replace', message: error.message })
    else lineItemsWritten += data || 0
  }

  // Replace the fee rows we own — checkout (Fastrr) and payment gateway
  // (Cashfree). Same atomic replace, scoped per source so re-syncing is
  // idempotent and never duplicates.
  const costsWritten = { [COST_SOURCE.FASTRR]: 0, [COST_SOURCE.CASHFREE]: 0 }
  for (const [source, rows] of [
    [COST_SOURCE.FASTRR,   checkoutCosts],
    [COST_SOURCE.CASHFREE, cashfreeCosts],
  ]) {
    for (const names of chunk(orderNames, RPC_CHUNK)) {
      const inChunk = new Set(names)
      const { data, error } = await supabase.rpc('replace_order_costs', {
        p_order_names: names,
        p_source:      source,
        p_rows:        rows.filter((c) => inChunk.has(c.shopify_order_name)),
      })
      if (error) errors.push({ row: `order_costs_replace_${source}`, message: error.message })
      else costsWritten[source] += data || 0
    }
  }

  const byStatus = allOrderRows.reduce((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1
    return acc
  }, {})

  return Response.json({
    synced:             orderNames.length,
    inserted:           insertedCount,
    updated:            updatedCount,
    by_status:          byStatus,
    line_items_created: lineItemsWritten,
    checkout_costs:     costsWritten[COST_SOURCE.FASTRR],
    gateway_costs:      costsWritten[COST_SOURCE.CASHFREE],
    errors,
    date:               new Date().toISOString(),
  })
}
