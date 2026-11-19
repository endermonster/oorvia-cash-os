/**
 * vFulfill shipments export → cc_shipments rows. Pure. One vFulfill account serves every store, so the store
 * comes from the Shopify order name's prefix (cc_stores.order_prefix), never from a vFulfill column.
 *
 * Only `Shipment Status` and the dates are read. The export's payment column is never used: payment comes
 * from Shopify (see CLAUDE.md, "Source of truth").
 */

export type ShipmentStatus = 'delivered' | 'rto' | 'open'
export type ShipmentRow = { store_id: string; order_name: string; status: ShipmentStatus; vf_status_raw: string; closed_on: string | null }

const STATUS: Record<string, ShipmentStatus> = {
  'delivered': 'delivered',
  'returned': 'rto',
  'rto in-transit': 'rto',
  'rto intransit': 'rto',
  'rto in transit': 'rto',
  'lost': 'rto', // never reached the customer: no revenue
  'ndr': 'open', // delivery attempted and failed, still out
  'in transit': 'open',
}

/** Null for a status this importer does not know: such a row is reported, never guessed. */
export const vfStatus = (raw: string): ShipmentStatus | null => STATUS[raw.trim().toLowerCase()] ?? null

const isBlank = (v: string | undefined) => { const s = (v ?? '').trim(); return s === '' || s === '-' || s.toUpperCase() === 'N/A' }

/** "2026-08-21 15:03:00" or "21-08-2026 ..." → "2026-08-21". Null for blank; throws on anything else. */
export function vfDate(v: string | undefined): string | null {
  if (isBlank(v)) return null
  const t = v!.trim().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(t)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  throw new Error(`unrecognised vFulfill date: ${JSON.stringify(v)}`)
}

/** The store whose order prefix the name starts with (followed by a digit); the longest prefix wins. Null if none. */
export function storeForOrder(orderName: string, stores: { id: string; order_prefix: string }[]): string | null {
  let best: { id: string; len: number } | null = null
  for (const s of stores) {
    const p = s.order_prefix
    if (p && orderName.startsWith(p) && /^\d/.test(orderName.slice(p.length)) && (!best || p.length > best.len)) best = { id: s.id, len: p.length }
  }
  return best?.id ?? null
}

export type ShipmentsReport = {
  rows: number
  byStatus: Record<string, number>
  /** Order names that match no store prefix. */
  noStore: string[]
  /** Raw statuses with no mapping, with counts (those rows are skipped). */
  unknownStatus: Record<string, number>
  /** Orders listed more than once: the last row wins. */
  duplicates: string[]
  /** Delivered with no Closed On: kept open, since the delivery date is unknown. */
  deliveredNoDate: string[]
  /** RTO with no Closed On: dated by RTO Marked On instead (Lost shipments have no Closed On). */
  rtoDatedByMarked: string[]
  /** Closed with no date at all: stored without closed_on, so not counted in delivery rates. */
  closedNoDate: string[]
}

export function mapShipments(records: Record<string, string>[], stores: { id: string; order_prefix: string }[]): { rows: ShipmentRow[]; report: ShipmentsReport } {
  const need = ['Shopify Order name', 'Shipment Status', 'Closed On', 'RTO Marked On']
  if (records.length > 0) {
    const missing = need.filter((c) => !(c in records[0]))
    if (missing.length) throw new Error(`not a vFulfill shipments export: missing ${missing.join(', ')}`)
  }
  const report: ShipmentsReport = { rows: records.length, byStatus: {}, noStore: [], unknownStatus: {}, duplicates: [], deliveredNoDate: [], rtoDatedByMarked: [], closedNoDate: [] }
  const out = new Map<string, ShipmentRow>()
  for (const r of records) {
    const name = r['Shopify Order name'].trim()
    const raw = r['Shipment Status'].trim()
    const store = storeForOrder(name, stores)
    if (!store) { report.noStore.push(name || '(blank)'); continue }
    let status = vfStatus(raw)
    if (!status) { report.unknownStatus[raw] = (report.unknownStatus[raw] ?? 0) + 1; continue }

    let closed: string | null = null
    if (status === 'delivered') {
      // Closed On is the delivery date only for a Delivered shipment.
      closed = vfDate(r['Closed On'])
      if (!closed) { report.deliveredNoDate.push(name); status = 'open' }
    } else if (status === 'rto') {
      closed = vfDate(r['Closed On'])
      if (!closed) {
        closed = vfDate(r['RTO Marked On'])
        if (closed) report.rtoDatedByMarked.push(name)
        else report.closedNoDate.push(name)
      }
    }

    const key = `${store}|${name}`
    if (out.has(key)) report.duplicates.push(name)
    out.set(key, { store_id: store, order_name: name, status, vf_status_raw: raw, closed_on: closed })
  }
  const rows = [...out.values()]
  for (const s of rows) report.byStatus[s.status] = (report.byStatus[s.status] ?? 0) + 1
  return { rows, report }
}

/**
 * Rows that should not overwrite what is stored: an older export must not reopen a shipment already closed.
 * `stored` maps "store|order" to the stored status.
 */
export function wouldReopen(rows: ShipmentRow[], stored: ReadonlyMap<string, ShipmentStatus>): ShipmentRow[] {
  return rows.filter((r) => r.status === 'open' && (stored.get(`${r.store_id}|${r.order_name}`) ?? 'open') !== 'open')
}

/**
 * Whether an import took the whole file in. Not, when rows were skipped as unreadable (unknown status, no store)
 * or nothing was written: such a run is recorded not ok so it cannot mark vFulfill fresh for every store.
 */
export const shipmentsComplete = (report: Pick<ShipmentsReport, 'unknownStatus' | 'noStore'>, written: number) =>
  written > 0 && Object.keys(report.unknownStatus).length === 0 && report.noStore.length === 0
