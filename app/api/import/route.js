import { supabase } from '@/lib/supabase'
import { computeOrderFees } from '@/lib/pnl'

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

async function importOrders(rows) {
  const valid = []
  const errors = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r.order_date || !r.payment_mode || !r.selling_price) {
      errors.push({ row: i + 2, message: 'Missing required fields: order_date, payment_mode, selling_price' })
      continue
    }
    const price = num(r.selling_price)
    const mode = r.payment_mode?.toLowerCase()
    if (!['prepaid', 'cod'].includes(mode)) {
      errors.push({ row: i + 2, message: `Invalid payment_mode: ${r.payment_mode}` })
      continue
    }
    const fees = computeOrderFees(price, mode)

    // Look up product by SKU if provided
    let productId = null
    if (r.product_sku) {
      const { data: prod } = await supabase.from('products').select('id').eq('sku', r.product_sku).single()
      productId = prod?.id || null
    }

    valid.push({
      shopify_order_id: r.shopify_order_id || null,
      order_date: r.order_date,
      payment_mode: mode,
      status: r.status || 'delivered',
      selling_price: price,
      checkout_fee: fees.checkout,
      payment_gateway_fee: fees.paymentGw,
      inbound_fee: num(r.inbound_fee),
      delivery_charge: num(r.delivery_charge),
      packing_fee: num(r.packing_fee),
      cod_handling_fee: num(r.cod_handling_fee),
      other_3pl_charges: num(r.other_3pl_charges),
      rto_charge: num(r.rto_charge),
      product_id: productId,
      notes: r.notes || null,
    })
  }

  if (valid.length > 0) {
    const { error } = await supabase.from('orders').insert(valid)
    if (error) return { inserted: 0, errors: [{ row: 'all', message: error.message }] }
  }

  return { inserted: valid.length, errors }
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
      spend_date: r.date || r.spend_date,
      campaign: r.campaign_name || r.campaign || null,
      adset: r.adset_name || r.adset || null,
      spend: num(r.amount_spent || r.spend),
      impressions: int_(r.impressions),
      clicks: int_(r.link_clicks || r.clicks),
      purchases: int_(r.purchases),
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
      amount: num(r.amount),
      reference: r.reference || null,
      notes: r.notes || null,
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
      name: r.name,
      sku: r.sku,
      category: r.category || null,
      cogs: num(r.cogs),
      selling_price: num(r.selling_price),
      weight_grams: int_(r.weight_grams),
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
  const file = formData.get('file')
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
  if (importType === 'orders') result = await importOrders(rows)
  else if (importType === 'ad_spend') result = await importAdSpend(rows)
  else if (importType === 'cod_wallet') result = await importCodWallet(rows)
  else result = await importProducts(rows)

  // Log the import
  await supabase.from('import_logs').insert([{
    import_type: importType,
    filename: file.name,
    row_count: rows.length,
    error_count: result.errors.length,
    errors: result.errors.length > 0 ? result.errors : null,
  }])

  return Response.json({
    inserted: result.inserted,
    total: rows.length,
    errors: result.errors,
  })
}
