import { supabase } from '@/lib/supabase'
import { selectAllIn } from '@/lib/paged'
import { today } from '@/lib/dates'
import { ORDER_STATUS, PAYMENT_TYPE, COST_SOURCE } from '@/lib/constants'

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

// ---------------------------------------------------------------------------
// CSV parser — same character-by-character approach as the Shopify importer
// so quoted commas don't break column alignment
// ---------------------------------------------------------------------------

function parseCSV(text) {
  const records = []
  let headers = null
  let row = []
  let field = ''
  let inQuote = false

  const flush = () => { row.push(field.trim()); field = '' }
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
        if (text[i + 1] === '"') { field += '"'; i++; continue }
        inQuote = false
      } else {
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
  if (field || row.length > 0) { flush(); commitRow() }
  return records
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

function r2(n)   { return Math.round(n * 100) / 100 }
function num(v)  { const n = parseFloat(v); return isNaN(n) ? 0 : n }
// vFulfill exports dates as either YYYY-MM-DD or DD-MM-YYYY depending on account locale
function vfDate(s) {
  if (!s || s === '-') return null
  const t = s.trim().slice(0, 10)
  if (/^\d{2}-\d{2}-\d{4}$/.test(t)) {
    const [d, m, y] = t.split('-')
    return `${y}-${m}-${d}`
  }
  return t
}
function blank(v)  { return !v || v === '-' }

// ---------------------------------------------------------------------------
// Transaction head classification
// ---------------------------------------------------------------------------

// Returns 'order' | 'wallet' | 'skip' for each transaction head.
function classifyHead(head) {
  const h = head.toLowerCase().trim()
  if (h.includes('rto handling fee'))          return 'order'
  if (h.includes('rto shipping'))              return 'order'
  if (h === 'fulfilment fees')                 return 'order'
  if (h === 'fulfillment fees')                return 'order'
  if (h === 'forward shipping')                return 'order'
  if (h === 'order managment fee')             return 'order'
  if (h === 'order management fee')            return 'order'
  if (h === 'convenience fees percentage')     return 'order'
  if (h === 'cod fees')                        return 'order'
  if (h.includes('cod remittance'))            return 'order'
  if (h.startsWith('add funds'))               return 'wallet'
  if (h === 'withdraw funds')                  return 'wallet'
  if (h === 'wallet recharge service fee')     return 'wallet'
  if (h === 'client sourcing request')         return 'wallet'
  if (h === 'inward fees')                     return 'wallet'
  if (h === 'storage charges')                 return 'wallet'
  return 'skip' // unknown head — stored nowhere, surfaced in warnings
}

// Maps wallet-only transaction heads to our wallet_transactions.type enum
function walletType(head) {
  const h = head.toLowerCase().trim()
  if (h.startsWith('add funds'))            return 'recharge'
  if (h === 'withdraw funds')               return 'withdrawal'
  if (h === 'wallet recharge service fee')  return 'service_fee'
  if (h === 'client sourcing request')      return 'sourcing'
  if (h === 'inward fees')                  return 'service_fee'
  if (h === 'storage charges')              return 'service_fee'
  return null
}

// ---------------------------------------------------------------------------
// POST /api/import/vfulfill
// Body: multipart/form-data with a `file` field (vFulfill transaction CSV)
// Prerequisite: run in Supabase SQL Editor once:
//   ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS vf_transaction_id TEXT UNIQUE;
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

  if (!('transaction_id' in rows[0] && 'transaction_head' in rows[0])) {
    return Response.json(
      { error: 'Unrecognised format. Expected a vFulfill transaction export CSV.' },
      { status: 400 }
    )
  }

  // Skip Declined rows
  const accepted = rows.filter(
    (r) => (r.transaction_status || '').toLowerCase() !== 'declined'
  )
  const declinedCount = rows.length - accepted.length

  // Separate order-linked from wallet-only
  const orderRows   = accepted.filter((r) => !blank(r.shopify_order_name))
  const walletRows  = accepted.filter((r) =>  blank(r.shopify_order_name))

  const errors   = []
  const warnings = []
  const unknownHeads = new Set()
  let costRowsWritten = 0

  // ---------------------------------------------------------------------------
  // 1. Process order-linked rows
  //    Group by shopify_order_name; derive status signal and vf_order_id.
  // ---------------------------------------------------------------------------
  const orderGroups = new Map() // shopify_order_name → { vf_order_id, hasRto, hasFullfilled, orderValue, orderDate, costRows[] }

  for (const r of orderRows) {
    const name = r.shopify_order_name.trim()
    const kind = classifyHead(r.transaction_head)

    if (kind === 'skip') { unknownHeads.add(r.transaction_head); continue }
    if (kind !== 'order') continue

    if (!orderGroups.has(name)) {
      orderGroups.set(name, {
        vf_order_id:      r.vf_order_id && r.vf_order_id !== '-' ? r.vf_order_id : null,
        orderValue:       num(r.order_value),
        orderDate:        vfDate(r.shopify_order_date),
        vfPaymentRaw:     r.payment_type || null,
        hasRto:           false,
        hasFulfilled:     false,
        hasCodRemittance: false,
        // NOTE: the transaction export carries no delivery date. The fulfilment-fee
        // charge date was previously used as a stand-in, but that is when vFulfill
        // picks and packs — measured against the shipments export it ran on average
        // 3.8 days early, which pushed revenue and GST into the wrong month. Real
        // delivery dates now come from the shipments CSV (/api/import/vf-shipments).
        deliveredAt:      null,
        costRows:         [],
      })
    }

    const g = orderGroups.get(name)
    if (!g.vf_order_id && !blank(r.vf_order_id)) g.vf_order_id = r.vf_order_id

    const headLower = r.transaction_head.toLowerCase().trim()
    const txDate    = vfDate(r.transaction_date)

    if (headLower.includes('rto'))                                            g.hasRto = true
    if (headLower === 'fulfilment fees' || headLower === 'fulfillment fees') {
      g.hasFulfilled = true
      // deliberately does NOT set deliveredAt — see the note above.
    }
    if (headLower.includes('cod remittance')) {
      g.hasCodRemittance = true
      // deliberate: remittance date is settlement, not delivery — never use it as delivered_at
    }

    // Use total_amt − taxable_amt for gst_amt — vFulfill's gst_amt column has
    // a known bug on some rows (Inward Fees) where it echoes taxable_amt instead.
    const taxable = r2(num(r.taxable_amt))
    const total   = r2(num(r.total_amt))
    const gst     = r2(total - taxable)

    g.costRows.push({
      shopify_order_name: name,
      transaction_head:   r.transaction_head,
      taxable_amt:        taxable,
      gst_amt:            gst,
      total_amt:          total,
      transaction_date:   vfDate(r.transaction_date),
      nature:             (r.transaction_nature || '').toLowerCase() === 'credit' ? 'credit' : 'debit',
      ratecard_type:      blank(r.lmd_ratecard_type) ? null : r.lmd_ratecard_type,
      source:             COST_SOURCE.VFULFILL,
    })
  }

  const orderNames = [...orderGroups.keys()]

  if (orderNames.length > 0) {
    // Check which orders already exist. Chunked: an unbounded .in() is
    // truncated at 1000 rows, which makes existing orders look missing — they
    // then get queued as stubs and collide on the primary key, aborting the
    // whole batch so no order gets its status or delivered_at.
    let existingRows
    try {
      existingRows = await selectAllIn(
        (names) => supabase.from('orders').select('shopify_order_name, status').in('shopify_order_name', names),
        orderNames
      )
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 })
    }

    const existingMap = new Map(existingRows.map((o) => [o.shopify_order_name, o]))
    const missingNames = orderNames.filter((n) => !existingMap.has(n))

    // Create stub orders for any names not found in DB (came from outside the Shopify import window)
    if (missingNames.length > 0) {
      const stubs = missingNames.map((name) => {
        const g         = orderGroups.get(name)
        // A fulfilment fee proves the order shipped, not that it arrived. Only a COD
        // remittance proves money changed hands. Anything else stays in flight until
        // the shipments import confirms delivery.
        const newStatus = g.hasRto ? ORDER_STATUS.RTO : g.hasCodRemittance ? ORDER_STATUS.DELIVERED : ORDER_STATUS.ACTIVE
        return {
          shopify_order_name:  name,
          payment_type:        PAYMENT_TYPE.UNKNOWN,
          vf_payment_type_raw: g.vfPaymentRaw,
          order_value:         g.orderValue || 0,
          order_date:          g.orderDate  || today(),
          status:              newStatus,
          vf_order_id:         g.vf_order_id,
          delivered_at:        newStatus === ORDER_STATUS.DELIVERED ? g.deliveredAt : null,
        }
      })
      // ON CONFLICT DO NOTHING: a stub must never overwrite a real order, and a
      // duplicate must never abort the batch.
      for (const batch of chunk(stubs, WRITE_CHUNK)) {
        const { error } = await supabase
          .from('orders')
          .upsert(batch, { onConflict: 'shopify_order_name', ignoreDuplicates: true })
        if (error) errors.push({ row: 'stub_orders', message: error.message })
      }
      warnings.push(`${missingNames.length} stub order(s) created (not in Shopify import): ${missingNames.slice(0, 5).join(', ')}${missingNames.length > 5 ? '…' : ''}`)
    }

    // Update existing orders: set vf_order_id + status (rto > delivered > keep)
    for (const [name, g] of orderGroups) {
      if (!existingMap.has(name)) continue // stubs handled above
      const current = existingMap.get(name)
      const newStatus = g.hasRto ? ORDER_STATUS.RTO : g.hasCodRemittance ? ORDER_STATUS.DELIVERED : null

      const updates = {}
      if (g.vf_order_id) updates.vf_order_id = g.vf_order_id
      // Only promote status — never regress (rto stays rto, delivered stays delivered)
      if (newStatus && current.status !== ORDER_STATUS.RTO) {
        if (newStatus === ORDER_STATUS.RTO || current.status === ORDER_STATUS.ACTIVE) {
          updates.status = newStatus
          if (newStatus === ORDER_STATUS.DELIVERED && g.deliveredAt) updates.delivered_at = g.deliveredAt
        }
      }

      if (Object.keys(updates).length > 0) {
        const { error } = await supabase
          .from('orders')
          .update(updates)
          .eq('shopify_order_name', name)
        if (error) errors.push({ order: name, message: error.message })
      }
    }

    // Replace vfulfill order_costs for all affected orders. The delete and the
    // insert share one transaction inside replace_order_costs() — a failed
    // insert used to leave the orders with their vFulfill costs wiped and no
    // way back.
    for (const names of chunk(orderNames, RPC_CHUNK)) {
      const rows = names.flatMap((n) => orderGroups.get(n).costRows)
      const { data, error } = await supabase.rpc('replace_order_costs', {
        p_order_names: names,
        p_source:      COST_SOURCE.VFULFILL,
        p_rows:        rows,
      })
      if (error) errors.push({ row: 'order_costs_replace', message: error.message })
      else costRowsWritten += data || 0
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Process wallet-only rows
  //    Upsert on vf_transaction_id to make re-imports idempotent.
  // ---------------------------------------------------------------------------
  const walletInserts = []
  for (const r of walletRows) {
    const type = walletType(r.transaction_head)
    if (!type) { unknownHeads.add(r.transaction_head); continue }

    const taxable = r2(num(r.taxable_amt))
    const total   = r2(num(r.total_amt))

    walletInserts.push({
      vf_transaction_id: r.transaction_id,
      wallet:            'vfulfill',
      type,
      amount:            total,
      taxable_amt:       taxable,
      gst_amt:           r2(total - taxable),
      date:              vfDate(r.transaction_date),
      note:              r.transaction_head,
    })
  }

  if (walletInserts.length > 0) {
    const { error } = await supabase
      .from('wallet_transactions')
      .upsert(walletInserts, { onConflict: 'vf_transaction_id', ignoreDuplicates: false })
    if (error) errors.push({ row: 'wallet_transactions', message: error.message })
  }

  if (unknownHeads.size > 0) {
    warnings.push(`Unknown transaction heads (not imported): ${[...unknownHeads].join(', ')}`)
  }

  return Response.json({
    orders_affected:     orderGroups.size,
    cost_rows_inserted:  costRowsWritten,
    wallet_rows:         walletInserts.length,
    declined_skipped:    declinedCount,
    errors,
    warnings,
  })
}
