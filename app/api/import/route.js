import { supabase } from '@/lib/supabase'

// Parse a CSV string into array of objects using the first row as headers
function parseCSV(text) {
  const lines = text.trim().split('\n').filter((l) => l.trim())
  if (lines.length < 2) return { rows: [], headers: [] }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''))
  const rows = lines.slice(1).map((line) => {
    const vals = splitCSVLine(line)
    const row = {}
    headers.forEach((h, i) => { row[h] = (vals[i] || '').trim() })
    return row
  })
  return { rows, headers }
}

// Handle quoted fields
function splitCSVLine(line) {
  const result = []
  let cur = ''
  let inQuote = false
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; continue }
    if (ch === ',' && !inQuote) { result.push(cur); cur = ''; continue }
    cur += ch
  }
  result.push(cur)
  return result
}

function num(v) { return parseFloat(v) || 0 }
function int_(v) { return parseInt(v) || null }
function r2(n) { return Math.round(n * 100) / 100 }

// ── vFulfill Transaction Export ──────────────────────────────────────────────
// vFulfill exports one row per transaction. Each order has multiple rows.
//
//  Order-linked heads (shopify_order_name present):
//   "Order Managment Fee"         → order_mgmt_fee        / wallet debit
//   "Convenience Fees Percentage" → platform_fee          / wallet debit
//   "COD Fees"                    → cod_fee               / wallet debit
//   "COD Remittance"              → cod_remittance        / wallet credit
//   "Forward Shipping"            → forward_shipping_fee  / wallet debit
//   "Fulfilment Fees"             → fulfillment_fee       / wallet debit
//   "RTO Handling Fee"            → rto_fee               / wallet debit
//   "RTO Shipping"                → rto_fee               / wallet debit
//
//  Wallet-only heads (no shopify_order_name):
//   "Add Funds - Wire Transfer"   → wallet add_funds
//   "Add Funds - Razorpay"        → wallet add_funds
//   "Withdraw Funds"              → wallet withdrawal
//   "Client Sourcing Request"     → wallet debit
//   "Wallet Recharge Service Fee" → wallet debit
//
// Accepted statuses: Processed, Pending, In_processing. Declined is skipped.
// COD detection: presence of COD Fees or COD Remittance → payment_mode = 'cod'.
// Dates: handles both YYYY-MM-DD and DD-MM-YYYY.

function isVfulfillCSV(firstRow) {
  return 'shopify_order_name' in firstRow && 'transaction_head' in firstRow
}

function parseVfDate(s) {
  if (!s || s === '-') return null
  s = s.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  if (/^\d{2}-\d{2}-\d{4}/.test(s)) {
    const [d, m, y] = s.split('-')
    return `${y}-${m}-${d}`
  }
  return null
}

const ACCEPTED_STATUSES = new Set(['processed', 'pending', 'in_processing'])

function normaliseVfulfillRows(rows) {
  const accepted = rows.filter((r) =>
    ACCEPTED_STATUSES.has((r.transaction_status || '').toLowerCase())
  )

  const orderMap    = new Map()
  const walletEntries = []

  for (const r of accepted) {
    const head      = (r.transaction_head || '').trim()
    const headLower = head.toLowerCase()
    const absAmt    = Math.abs(parseFloat(r.total_amt) || 0)
    const txnId     = r.transaction_id || null
    const txnDate   = parseVfDate(r.transaction_date)
    const orderName = (r.shopify_order_name || '').trim()
    const txnStatus = (r.transaction_status || '').toLowerCase()
    const hasOrder  = orderName && orderName !== '-'

    if (hasOrder) {
      if (!orderMap.has(orderName)) {
        orderMap.set(orderName, {
          shopify_order_name:   orderName,
          order_date:           parseVfDate(r.shopify_order_date),
          order_value:          0,
          qty:                  null,
          gst_rate:             null,
          order_mgmt_fee:       0,
          platform_fee:         0,
          cod_fee:              0,
          forward_shipping_fee: 0,
          fulfillment_fee:      0,
          rto_fee:              0,
          cod_remittance:       0,
          hasCodTransaction:    false,
          hasRto:               false,
        })
      }

      const order = orderMap.get(orderName)

      if (!order.order_value && r.order_value && r.order_value !== '-') {
        order.order_value = parseFloat(r.order_value) || 0
      }
      if (order.qty === null && r.qty && r.qty !== '-') {
        order.qty = parseInt(r.qty) || null
      }
      if (order.gst_rate === null && r.vf_sku_gst_percentage && r.vf_sku_gst_percentage !== '-') {
        order.gst_rate = parseFloat(r.vf_sku_gst_percentage) || null
      }

      const walletBase = {
        entry_date:         txnDate,
        amount:             absAmt,
        reference:          head,
        shopify_order_id:   orderName,
        vf_transaction_id:  txnId,
        transaction_status: txnStatus,
      }

      if (headLower.includes('order managment fee') || headLower.includes('order management fee')) {
        order.order_mgmt_fee += absAmt
        walletEntries.push({ ...walletBase, entry_type: 'debit' })
      } else if (headLower.includes('convenience fees')) {
        order.platform_fee += absAmt
        walletEntries.push({ ...walletBase, entry_type: 'debit' })
      } else if (headLower === 'cod fees') {
        order.cod_fee += absAmt
        order.hasCodTransaction = true
        walletEntries.push({ ...walletBase, entry_type: 'debit' })
      } else if (headLower.includes('cod remittance')) {
        order.cod_remittance += absAmt
        order.hasCodTransaction = true
        walletEntries.push({ ...walletBase, entry_type: 'credit' })
      } else if (headLower === 'forward shipping') {
        order.forward_shipping_fee += absAmt
        walletEntries.push({ ...walletBase, entry_type: 'debit' })
      } else if (headLower === 'fulfilment fees' || headLower === 'fulfillment fees') {
        order.fulfillment_fee += absAmt
        walletEntries.push({ ...walletBase, entry_type: 'debit' })
      } else if (headLower.includes('rto handling fee') || headLower.includes('rto shipping')) {
        order.rto_fee += absAmt
        order.hasRto = true
        walletEntries.push({ ...walletBase, entry_type: 'debit' })
      }
    } else {
      // Wallet-only heads
      let entry_type = null
      if (headLower.startsWith('add funds')) {
        entry_type = 'add_funds'
      } else if (headLower === 'withdraw funds') {
        entry_type = 'withdrawal'
      } else if (headLower === 'client sourcing request' || headLower === 'wallet recharge service fee') {
        entry_type = 'debit'
      }

      if (entry_type) {
        walletEntries.push({
          entry_date:         txnDate,
          entry_type,
          amount:             absAmt,
          reference:          head,
          shopify_order_id:   null,
          vf_transaction_id:  txnId,
          transaction_status: txnStatus,
        })
      }
    }
  }

  const orders = [...orderMap.values()].map((o) => {
    const mode   = o.hasCodTransaction ? 'cod' : 'prepaid'
    const status = o.hasRto ? 'rto' : 'delivered'

    let settlement_status
    if (o.cod_remittance > 0)    settlement_status = 'settled'
    else if (o.platform_fee > 0) settlement_status = 'in-transit'
    else                         settlement_status = 'new'

    return {
      shopify_order_id:     o.shopify_order_name,
      order_date:           o.order_date,
      payment_mode:         mode,
      status,
      order_value:          r2(o.order_value),
      qty:                  o.qty,
      gst_rate:             o.gst_rate ?? 18,
      checkout_fee:         r2(o.order_value * 0.0236),
      cashfree_fee:         mode === 'prepaid' ? r2(o.order_value * 0.025) : 0,
      order_mgmt_fee:       r2(o.order_mgmt_fee),
      platform_fee:         r2(o.platform_fee),
      cod_fee:              r2(o.cod_fee),
      forward_shipping_fee: r2(o.forward_shipping_fee),
      fulfillment_fee:      r2(o.fulfillment_fee),
      rto_fee:              r2(o.rto_fee),
      cod_remittance:       r2(o.cod_remittance),
      settlement_status,
    }
  })

  return { orders, walletEntries }
}
// ────────────────────────────────────────────────────────────────────────────

async function importOrders(rows) {
  if (!isVfulfillCSV(rows[0])) {
    return {
      inserted: 0,
      errors: [{ row: 1, message: 'Unrecognised order CSV format. Expected a vFulfill transaction export.' }],
    }
  }

  const { orders, walletEntries } = normaliseVfulfillRows(rows)

  if (orders.length === 0 && walletEntries.length === 0) {
    return { inserted: 0, errors: [{ row: 'all', message: 'No valid orders or wallet entries found in vFulfill export.' }] }
  }

  const errors = []

  if (orders.length > 0) {
    const { error } = await supabase
      .from('orders')
      .upsert(orders, { onConflict: 'shopify_order_id' })
    if (error) errors.push({ row: 'orders', message: error.message })
  }

  if (walletEntries.length > 0) {
    const { error } = await supabase
      .from('cod_wallet_entries')
      .upsert(walletEntries, { onConflict: 'vf_transaction_id', ignoreDuplicates: true })
    if (error) errors.push({ row: 'wallet', message: error.message })
  }

  return { inserted: orders.length, errors }
}

async function importAdSpend(rows) {
  const valid = []
  const errors = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    // Meta Ads Manager exports: "Reporting starts" → reporting_starts, "Amount spent (INR)" → amount_spent_inr
    const spendDate = r.date || r.spend_date || r.reporting_starts || r.reporting_ends
    const spend     = r.amount_spent || r.spend || r.amount_spent_inr
    if (!spendDate || !spend) {
      errors.push({ row: i + 2, message: 'Missing required fields: date and spend amount' })
      continue
    }
    valid.push({
      spend_date:  spendDate,
      campaign:    r.campaign_name || r.campaign || null,
      adset:       r.adset_name || r.adset_name_ || r.adset || null,
      spend:       num(spend),
      impressions: int_(r.impressions),
      clicks:      int_(r.link_clicks || r.clicks || r.unique_outbound_clicks),
      purchases:   int_(r.purchases),
    })
  }

  if (valid.length > 0) {
    const { error } = await supabase.from('ad_spend').insert(valid)
    if (error) return { inserted: 0, errors: [{ row: 'all', message: error.message }] }
  }

  return { inserted: valid.length, errors }
}

async function importCodWallet(rows) {
  const valid = []
  const errors = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r.date || !r.type || !r.amount) {
      errors.push({ row: i + 2, message: 'Missing required fields: date, type, amount' })
      continue
    }
    const type = r.type?.toLowerCase()
    if (!['credit', 'debit', 'withdrawal'].includes(type)) {
      errors.push({ row: i + 2, message: `Invalid type: ${r.type}` })
      continue
    }
    valid.push({
      entry_date: r.date || r.entry_date,
      entry_type: type,
      amount:     num(r.amount),
      reference:  r.reference || null,
      notes:      r.notes || null,
    })
  }

  if (valid.length > 0) {
    const { error } = await supabase.from('cod_wallet_entries').insert(valid)
    if (error) return { inserted: 0, errors: [{ row: 'all', message: error.message }] }
  }

  return { inserted: valid.length, errors }
}

async function importProducts(rows) {
  const valid = []
  const errors = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r.name || !r.sku) {
      errors.push({ row: i + 2, message: 'Missing required fields: name, sku' })
      continue
    }
    valid.push({
      name:          r.name,
      sku:           r.sku,
      category:      r.category || null,
      cogs:          num(r.cogs),
      selling_price: num(r.selling_price),
      weight_grams:  int_(r.weight_grams),
    })
  }

  if (valid.length > 0) {
    const { error } = await supabase.from('products').upsert(valid, { onConflict: 'sku' })
    if (error) return { inserted: 0, errors: [{ row: 'all', message: error.message }] }
  }

  return { inserted: valid.length, errors }
}

export async function POST(request) {
  const contentType = request.headers.get('content-type') || ''

  if (!contentType.includes('multipart/form-data')) {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const formData = await request.formData()
  const file       = formData.get('file')
  const importType = formData.get('type')

  if (!file || typeof file === 'string') {
    return Response.json({ error: 'No file uploaded' }, { status: 400 })
  }

  const validTypes = ['orders', 'ad_spend', 'cod_wallet', 'products']
  if (!validTypes.includes(importType)) {
    return Response.json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` }, { status: 400 })
  }

  const text = await file.text()
  const { rows } = parseCSV(text)

  if (rows.length === 0) {
    return Response.json({ error: 'CSV is empty or has no data rows' }, { status: 400 })
  }

  let result
  if (importType === 'orders')       result = await importOrders(rows)
  else if (importType === 'ad_spend') result = await importAdSpend(rows)
  else if (importType === 'cod_wallet') result = await importCodWallet(rows)
  else result = await importProducts(rows)

  await supabase.from('import_logs').insert([{
    import_type:  importType,
    filename:     file.name,
    row_count:    rows.length,
    error_count:  result.errors.length,
    errors:       result.errors.length > 0 ? result.errors : null,
  }])

  return Response.json({
    inserted: result.inserted,
    total:    rows.length,
    errors:   result.errors,
  })
}
