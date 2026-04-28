import { supabase } from '@/lib/supabase'
import { mapShopifyStatus } from '@/lib/shopify'

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

// Walks the raw text one character at a time so multi-line quoted fields
// (e.g. Shopify's Note Attributes column) don't break row boundaries.
function parseCSV(text) {
  const records = []
  let headers = null
  let row = []
  let field = ''
  let inQuote = false

  const flush = () => {
    row.push(field.trim())
    field = ''
  }
  const commitRow = () => {
    if (row.length === 0 || row.every((f) => f === '')) return
    if (!headers) {
      headers = row.map((h) => h.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''))
    } else if (headers.length > 0) {
      const obj = {}
      headers.forEach((h, i) => { obj[h] = row[i] ?? '' })
      records.push(obj)
    }
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; continue } // escaped ""
        inQuote = false
      } else {
        // Newlines inside quotes are part of the field value — don't split on them
        if (ch !== '\r') field += ch
      }
    } else {
      if      (ch === '"')  { inQuote = true }
      else if (ch === ',')  { flush() }
      else if (ch === '\n') { flush(); commitRow() }
      else if (ch === '\r') { /* skip */ }
      else                  { field += ch }
    }
  }
  // Flush any trailing content
  if (field || row.length > 0) { flush(); commitRow() }

  return records
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

function r2(n) { return Math.round(n * 100) / 100 }

// Shopify "Created at": "2024-01-15 10:30:00 +0530" or ISO — take YYYY-MM-DD
function parseShopifyDate(s) {
  if (!s) return null
  return s.slice(0, 10)
}

// ---------------------------------------------------------------------------
// Payment type mapping
// Shopify is the source of truth. vFulfill's Payment Type is ignored.
// ---------------------------------------------------------------------------

function mapPaymentType(raw) {
  const v = (raw || '').toLowerCase().trim()
  if (v.includes('cash on delivery') || v.includes('cod')) return 'cash_on_delivery'
  if (v.includes('cashfree'))  return 'prepaid_cashfree'
  if (v.includes('razorpay'))  return 'prepaid_razorpay'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// POST /api/import/shopify
// Body: multipart/form-data with a `file` field (Shopify order export CSV)
// ---------------------------------------------------------------------------

export async function POST(request) {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const formData = await request.formData()
  const file = formData.get('file')
  if (!file || typeof file === 'string') {
    return Response.json({ error: 'No file uploaded' }, { status: 400 })
  }

  const text = await file.text()
  const rows = parseCSV(text)

  if (rows.length === 0) {
    return Response.json({ error: 'CSV is empty or has no data rows' }, { status: 400 })
  }

  if (!('name' in rows[0] && 'financial_status' in rows[0])) {
    return Response.json(
      { error: 'Unrecognised format. Expected a Shopify order export CSV (must have Name and Financial Status columns).' },
      { status: 400 }
    )
  }

  // Skip only rows with no order name (blank line-item continuation rows, drafts)
  const eligible = rows.filter((r) => r.name?.trim())
  const skippedCount = rows.length - eligible.length

  // Group by order name — Shopify repeats order-level fields for each line item row
  const orderMap = new Map()
  for (const r of eligible) {
    const name = r.name?.trim()
    if (!name) continue

    if (!orderMap.has(name)) {
      orderMap.set(name, { meta: r, lineItems: [] })
    }

    const sku = r.lineitem_sku?.trim() || null
    const lineitemName = r.lineitem_name?.trim() || null
    if (sku || lineitemName) {
      orderMap.get(name).lineItems.push({
        sku,
        qty:        parseInt(r.lineitem_quantity) || 1,
        unit_price: parseFloat(r.lineitem_price)  || 0,
      })
    }
  }

  if (orderMap.size === 0) {
    return Response.json({
      inserted: 0, updated: 0, skipped: skippedCount, errors: [],
      message: 'No paid+fulfilled orders found in this export.',
    })
  }

  const orderNames = [...orderMap.keys()]
  const unknownPaymentRaws = []
  const errors = []

  // Build data arrays
  const allOrderRows     = []
  const allLineItems     = []
  const allOrderCosts    = []

  for (const [name, { meta, lineItems }] of orderMap) {
    const orderDate  = parseShopifyDate(meta.created_at)
    const orderValue = parseFloat(meta.total) || 0
    const rawPayment = meta.payment_method?.trim() || ''
    const paymentType = mapPaymentType(rawPayment)

    if (paymentType === 'unknown' && rawPayment) {
      unknownPaymentRaws.push(rawPayment)
    }

    const financialStatus   = (meta.financial_status  || '').toLowerCase().trim()
    const fulfillmentStatus = (meta.fulfillment_status || '').toLowerCase().trim()
    const cancelledAt       = meta.cancelled_at?.trim() || null
    const initialStatus     = mapShopifyStatus(financialStatus, fulfillmentStatus, cancelledAt)

    allOrderRows.push({
      shopify_order_name: name,
      payment_type:       paymentType,
      order_value:        r2(orderValue),
      order_date:         orderDate,
      status:             initialStatus,
      ship_state:         meta.shipping_province?.trim() || null,
    })

    for (const li of lineItems) {
      allLineItems.push({
        shopify_order_name: name,
        sku:        li.sku,
        qty:        li.qty,
        unit_price: r2(li.unit_price),
      })
    }

    // Fastrr checkout service fee — 2% base + 18% GST on that 2%
    const taxableAmt = r2(orderValue * 0.02)
    const gstAmt     = r2(taxableAmt * 0.18)
    allOrderCosts.push({
      shopify_order_name: name,
      transaction_head:   'Checkout Service Fee',
      taxable_amt:        taxableAmt,
      gst_amt:            gstAmt,
      total_amt:          r2(orderValue * 0.0236),
      transaction_date:   orderDate,
      nature:             'debit',
      source:             'fastrr',
    })
  }

  // ---------------------------------------------------------------------------
  // Upsert orders:
  //   - New orders  → insert with status='active'
  //   - Existing    → update only payment_type, order_value, ship_state, order_date
  //                   (do NOT overwrite status or vf_order_id set by vFulfill)
  // ---------------------------------------------------------------------------
  const { data: existingRows, error: fetchErr } = await supabase
    .from('orders')
    .select('shopify_order_name')
    .in('shopify_order_name', orderNames)

  if (fetchErr) return Response.json({ error: fetchErr.message }, { status: 500 })

  const existingSet = new Set((existingRows || []).map((o) => o.shopify_order_name))
  const newOrders   = allOrderRows.filter((o) => !existingSet.has(o.shopify_order_name))
  const oldOrders   = allOrderRows.filter((o) =>  existingSet.has(o.shopify_order_name))

  if (newOrders.length > 0) {
    const { error } = await supabase.from('orders').insert(newOrders)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  for (const o of oldOrders) {
    const { error } = await supabase
      .from('orders')
      .update({
        payment_type: o.payment_type,
        order_value:  o.order_value,
        ship_state:   o.ship_state,
        order_date:   o.order_date,
      })
      .eq('shopify_order_name', o.shopify_order_name)
    if (error) errors.push({ order: o.shopify_order_name, message: error.message })
  }

  // ---------------------------------------------------------------------------
  // Replace line items for these orders (delete + insert handles re-imports)
  // ---------------------------------------------------------------------------
  const { error: delLiErr } = await supabase
    .from('order_line_items')
    .delete()
    .in('shopify_order_name', orderNames)
  if (delLiErr) errors.push({ row: 'line_items_delete', message: delLiErr.message })

  if (allLineItems.length > 0) {
    // Auto-create stub products for any SKUs not yet in the products table
    const uniqueSkus = [...new Set(allLineItems.map(li => li.sku).filter(Boolean))]
    if (uniqueSkus.length > 0) {
      const { data: existingProducts } = await supabase
        .from('products').select('sku').in('sku', uniqueSkus)
      const existingSkuSet = new Set((existingProducts || []).map(p => p.sku))
      const missingSkus = uniqueSkus.filter(s => !existingSkuSet.has(s))
      if (missingSkus.length > 0) {
        const { error: stubErr } = await supabase.from('products')
          .insert(missingSkus.map(sku => ({ sku, name: sku, current_cogs: 0 })))
        if (stubErr) errors.push({ row: 'products_stub', message: stubErr.message })
      }
    }

    const { error } = await supabase.from('order_line_items').insert(allLineItems)
    if (error) errors.push({ row: 'line_items_insert', message: error.message })
  }

  // ---------------------------------------------------------------------------
  // Replace Fastrr order_costs for these orders (idempotent re-import)
  // ---------------------------------------------------------------------------
  const { error: delCostErr } = await supabase
    .from('order_costs')
    .delete()
    .in('shopify_order_name', orderNames)
    .eq('source', 'fastrr')
  if (delCostErr) errors.push({ row: 'order_costs_delete', message: delCostErr.message })

  const { error: costsErr } = await supabase.from('order_costs').insert(allOrderCosts)
  if (costsErr) errors.push({ row: 'order_costs_insert', message: costsErr.message })

  // ---------------------------------------------------------------------------
  // Response
  // ---------------------------------------------------------------------------
  const warnings = unknownPaymentRaws.length > 0
    ? [`Unrecognised payment methods mapped to 'unknown': ${[...new Set(unknownPaymentRaws)].join(', ')}`]
    : []

  return Response.json({
    inserted:           newOrders.length,
    updated:            oldOrders.length,
    skipped:            skippedCount,
    line_items_created: allLineItems.length,
    errors,
    warnings,
  })
}
