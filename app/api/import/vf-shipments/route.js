import { supabase } from '@/lib/supabase'
import { selectAllIn } from '@/lib/paged'
import { ORDER_STATUS } from '@/lib/constants'
import { parseCSV } from '@/lib/csv'

// ---------------------------------------------------------------------------
// POST /api/import/vf-shipments
//
// The vFulfill *shipments* export is the only source that carries a real
// delivery date. The transaction export does not, and the importer used to
// substitute the fulfilment-fee charge date — which is when vFulfill picks and
// packs. Measured against this file that ran on average 3.8 days early and up
// to 13, which moved revenue and GST output tax into the wrong month.
//
// Columns used: Shopify Order name, Shipment Status, Closed On, RTO Marked On,
// Shipment Date, Customer state.
// ---------------------------------------------------------------------------

// vFulfill shipment status -> our order status.
const STATUS_MAP = {
  'delivered':      ORDER_STATUS.DELIVERED,
  'returned':       ORDER_STATUS.RTO,
  'rto in-transit': ORDER_STATUS.RTO,
  'rto intransit':  ORDER_STATUS.RTO,
  'lost':           ORDER_STATUS.RTO, // never reached the customer; no revenue
  'ndr':            ORDER_STATUS.ACTIVE, // delivery attempted and failed, still out
  'in transit':     ORDER_STATUS.ACTIVE,
}

function blank(v) {
  const s = (v ?? '').toString().trim()
  return s === '' || s === '-' || s.toUpperCase() === 'N/A'
}

// vFulfill emits ISO-ish timestamps; take the date part only.
function vfDate(v) {
  if (blank(v)) return null
  const t = v.toString().trim().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  if (/^\d{2}-\d{2}-\d{4}$/.test(t)) {
    const [d, m, y] = t.split('-')
    return `${y}-${m}-${d}`
  }
  return null
}

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

  let rows
  try {
    rows = parseCSV(await file.text())
  } catch (e) {
    return Response.json({ error: `Could not parse the CSV: ${e.message}` }, { status: 400 })
  }

  if (rows.length === 0) {
    return Response.json({ error: 'CSV is empty or has no data rows' }, { status: 400 })
  }
  if (!('shopify_order_name' in rows[0]) || !('shipment_status' in rows[0])) {
    return Response.json(
      { error: 'Unrecognised format. Expected a vFulfill Shipments export (needs "Shopify Order name" and "Shipment Status").' },
      { status: 400 }
    )
  }

  const warnings = []
  const errors = []
  const unknownStatuses = new Set()

  // Last row wins if an order appears twice.
  const byOrder = new Map()
  for (const r of rows) {
    const name = (r.shopify_order_name || '').trim()
    if (!name) continue

    const raw = (r.shipment_status || '').trim().toLowerCase()
    const status = STATUS_MAP[raw]
    if (!status) { unknownStatuses.add(r.shipment_status); continue }

    const closedOn = vfDate(r.closed_on)

    // "Closed On" is the delivery date for a delivered shipment, and the
    // warehouse-receipt date for a returned one — only the former is a delivery.
    let deliveredAt = status === ORDER_STATUS.DELIVERED ? closedOn : null

    // Delivered with no close date means vFulfill has not confirmed it yet.
    let finalStatus = status
    if (status === ORDER_STATUS.DELIVERED && !deliveredAt) {
      finalStatus = ORDER_STATUS.ACTIVE
      warnings.push(`${name}: marked Delivered with no "Closed On" date — left in transit`)
    }

    byOrder.set(name, {
      shopify_order_name: name,
      status: finalStatus,
      delivered_at: deliveredAt,
      rto_marked_on: vfDate(r.rto_marked_on),
      shipped_at: vfDate(r.shipment_date),
      ship_state: blank(r.customer_state) ? null : r.customer_state.trim(),
    })
  }

  if (byOrder.size === 0) {
    return Response.json({ error: 'No usable shipment rows found' }, { status: 400 })
  }

  const names = [...byOrder.keys()]

  // Only touch orders we already have. Shipments never create orders — that is
  // the Shopify sync's job, and inventing one here would have no order value.
  let existing
  try {
    existing = await selectAllIn(
      (chunk) => supabase.from('orders')
        .select('shopify_order_name, status, delivered_at, ship_state')
        .in('shopify_order_name', chunk),
      names
    )
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }

  const existingMap = new Map(existing.map((o) => [o.shopify_order_name, o]))
  const missing = names.filter((n) => !existingMap.has(n))
  if (missing.length > 0) {
    warnings.push(
      `${missing.length} shipment(s) skipped — no matching order. Run the Shopify sync first: ` +
      `${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`
    )
  }

  let statusChanged = 0
  let dateChanged = 0
  let stateFilled = 0
  let unchanged = 0

  for (const [name, s] of byOrder) {
    const cur = existingMap.get(name)
    if (!cur) continue

    const updates = {}
    if (cur.status !== s.status) updates.status = s.status
    if ((cur.delivered_at ?? null) !== (s.delivered_at ?? null)) updates.delivered_at = s.delivered_at
    // Only fill a blank ship_state; the Shopify CSV is authoritative for it.
    if (!cur.ship_state && s.ship_state) updates.ship_state = s.ship_state

    if (Object.keys(updates).length === 0) { unchanged++; continue }

    if (updates.status) statusChanged++
    if ('delivered_at' in updates) dateChanged++
    if (updates.ship_state) stateFilled++

    updates.updated_at = new Date().toISOString()
    const { error } = await supabase.from('orders').update(updates).eq('shopify_order_name', name)
    if (error) errors.push({ order: name, message: error.message })
  }

  if (unknownStatuses.size > 0) {
    warnings.push(`Unrecognised shipment statuses (rows skipped): ${[...unknownStatuses].join(', ')}`)
  }

  return Response.json({
    shipments_read:  byOrder.size,
    matched_orders:  byOrder.size - missing.length,
    status_updated:  statusChanged,
    delivery_dates_updated: dateChanged,
    ship_states_filled: stateFilled,
    unchanged,
    skipped_no_order: missing.length,
    warnings,
    errors,
  })
}
