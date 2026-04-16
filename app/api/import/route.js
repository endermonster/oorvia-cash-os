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
// vFulfill exports one row per transaction. Each order produces multiple rows:
//   "Order Managment Fee"        — charged on order placement (note: typo is theirs)
//   "Convenience Fees Percentage"— platform fee, charged on dispatch
//   "COD Fees"                   — COD handling fee, charged on delivery
//   "COD Remittance"             — credit, cash remitted back to you
//
// Detection: presence of 'shopify_order_name' + 'transaction_head' columns.
// Strategy:  group by Shopify Order Name, aggregate each fee type, derive
//            checkout_fee and cashfree_fee from order_value + payment_mode.

function isVfulfillCSV(firstRow) {
  return 'shopify_order_name' in firstRow && 'transaction_head' in firstRow
}

function normaliseVfulfillRows(rows) {
  // Skip non-Processed rows and rows with no Shopify order reference
  const valid = rows.filter((r) =>
    r.transaction_status === 'Processed' &&
    r.shopify_order_name &&
    r.shopify_order_name !== '-'
  )

  const orderMap = new Map()

  for (const r of valid) {
    const key = r.shopify_order_name
    if (!orderMap.has(key)) {
      orderMap.set(key, {
        shopify_order_name: key,
        order_date:         r.shopify_order_date ? r.shopify_order_date.slice(0, 10) : null,
        payment_type:       r.payment_type || '',
        order_value:        parseFloat(r.order_value) || 0,
        qty:                null,
        gst_rate:           null,
        order_mgmt_fee:     0,
        platform_fee:       0,
        cod_fee:            0,
        cod_remittance:     0,
      })
    }

    const order = orderMap.get(key)
    const amt  = parseFloat(r.total_amt) || 0
    const head = (r.transaction_head || '').toLowerCase().trim()

    // Grab qty and gst_rate from the first item row that carries them
    if (order.qty === null && r.qty && r.qty !== '-') {
      order.qty = parseInt(r.qty) || null
    }
    if (order.gst_rate === null && r.vf_sku_gst_percentage && r.vf_sku_gst_percentage !== '-') {
      order.gst_rate = parseFloat(r.vf_sku_gst_percentage) || null
    }

    // Accumulate fee buckets
    if (head.includes('order managment fee') || head.includes('order management fee')) {
      order.order_mgmt_fee += amt
    } else if (head.includes('convenience fees')) {
      order.platform_fee += amt
    } else if (head === 'cod fees') {
      order.cod_fee += amt
    } else if (head.includes('cod remittance')) {
      order.cod_remittance += amt
    }
  }

  return [...orderMap.values()].map((o) => {
    const mode       = (o.payment_type || '').toLowerCase() === 'cod' ? 'cod' : 'prepaid'
    const orderValue = o.order_value

    // settlement_status derived from which fee types are present
    let settlement_status
    if (o.cod_remittance > 0)      settlement_status = 'settled'
    else if (o.platform_fee > 0)   settlement_status = 'in-transit'
    else                           settlement_status = 'new'

    return {
      shopify_order_id:  o.shopify_order_name,
      order_date:        o.order_date,
      payment_mode:      mode,
      status:            'delivered',
      order_value:       r2(orderValue),
      qty:               o.qty,
      gst_rate:          o.gst_rate ?? 18,
      checkout_fee:      r2(orderValue * 0.0236),          // 2% + 18% GST, from Shopify
      cashfree_fee:      mode === 'prepaid' ? r2(orderValue * 0.025) : 0,
      order_mgmt_fee:    r2(o.order_mgmt_fee),
      platform_fee:      r2(o.platform_fee),
      cod_fee:           r2(o.cod_fee),
      cod_remittance:    r2(o.cod_remittance),
      settlement_status,
    }
  })
}
// ────────────────────────────────────────────────────────────────────────────

async function importOrders(rows) {
  if (!isVfulfillCSV(rows[0])) {
    return {
      inserted: 0,
      errors: [{ row: 1, message: 'Unrecognised order CSV format. Expected a vFulfill transaction export.' }],
    }
  }

  const normalised = normaliseVfulfillRows(rows)
  if (normalised.length === 0) {
    return { inserted: 0, errors: [{ row: 'all', message: 'No valid Processed orders found in vFulfill export.' }] }
  }

  const { error } = await supabase
    .from('orders')
    .upsert(normalised, { onConflict: 'shopify_order_id' })

  if (error) return { inserted: 0, errors: [{ row: 'all', message: error.message }] }
  return { inserted: normalised.length, errors: [] }
}

async function importAdSpend(rows) {
  const valid = []
  const errors = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r.date || !r.amount_spent) {
      errors.push({ row: i + 2, message: 'Missing required fields: date, amount_spent' })
      continue
    }
    valid.push({
      spend_date:  r.date || r.spend_date,
      campaign:    r.campaign_name || r.campaign || null,
      adset:       r.adset_name || r.adset || null,
      spend:       num(r.amount_spent || r.spend),
      impressions: int_(r.impressions),
      clicks:      int_(r.link_clicks || r.clicks),
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
