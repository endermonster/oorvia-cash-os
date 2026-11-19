/**
 * vFulfill transactions export → cc_vf_transactions rows: the wallet ledger, one row per Transaction ID. Pure.
 *
 * Every processed row with money is kept, whatever its head, so the wallet balance (credits − debits) stays
 * complete; heads this module does not know are reported, not dropped. The export's Payment Type column is
 * never read (see CLAUDE.md, "Source of truth").
 *
 * A multi-product order repeats a Transaction ID once per extra item, with "-" as the amount: those rows carry
 * no money and are skipped.
 */
import { storeForOrder, vfDate } from './shipments'

export type TxnRow = {
  txn_id: string
  txn_date: string
  store_id: string | null
  order_name: string | null
  vf_order_id: string | null
  head: string
  nature: 'debit' | 'credit'
  taxable_paise: number | null
  gst_paise: number | null
  total_paise: number
  /** Total Amt exactly as exported (up to 6 decimals): the wallet is summed from this, then rounded once. */
  total_exact: string
  particulars: string | null
  remarks: string | null
}

/** Heads seen in vFulfill exports. Order heads carry a Shopify order name; wallet heads do not. */
export const ORDER_HEADS = [
  'Fulfilment Fees', 'Forward Shipping', 'Order Managment Fee', 'Convenience Fees Percentage', 'COD Fees',
  'COD Remittance', 'RTO Handling Fee', 'RTO Shipping', 'Lost Claims', 'Checkout Service Fee',
] as const
export const WALLET_HEADS = [
  'Add Funds - Wire', 'Add Funds - Razorpay', 'Withdraw Funds', 'Wallet Recharge Service Fee', 'Client Sourcing Request',
  'Inward Fees', 'Storage Charges', 'Subscription Charge',
] as const
const KNOWN = new Set<string>([...ORDER_HEADS, ...WALLET_HEADS])

const isBlank = (v: string | undefined) => { const s = (v ?? '').trim(); return s === '' || s === '-' || s.toUpperCase() === 'N/A' }
const text = (v: string | undefined) => (isBlank(v) ? null : v!.trim())

/** Rupees → integer paise; null for blank. Throws on anything that is not a number. */
export function paiseOf(v: string | undefined): number | null {
  if (isBlank(v)) return null
  const n = Number(v!.trim().replace(/,/g, ''))
  if (!Number.isFinite(n)) throw new Error(`not an amount: ${JSON.stringify(v)}`)
  return Math.round(n * 100)
}

/** A non-negative decimal string, normalised ("1,399" → "1399", "068.10" → "68.1"). Throws beyond 6 decimals. */
export function exactOf(v: string): string {
  const t = v.trim().replace(/,/g, '')
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t)
  if (!m) throw new Error(`not a non-negative amount: ${JSON.stringify(v)}`)
  const frac = (m[2] ?? '').replace(/0+$/, '')
  if (frac.length > 6) throw new Error(`more than 6 decimals: ${JSON.stringify(v)}`)
  const int = m[1].replace(/^0+(?=\d)/, '')
  return frac ? `${int}.${frac}` : int
}

/** An exact decimal string in millionths of a rupee, as an integer (no float rounding per row). */
const micros = (exact: string) => { const [i, f = ''] = exact.split('.'); return Number(i) * 1e6 + Number(f.padEnd(6, '0')) }

export type TxnReport = {
  rows: number
  /** Declined rows: never happened, skipped. Sum in paise. */
  declined: { count: number; paise: number }
  /** Extra item lines of a multi-product order ("-" amounts): skipped. */
  itemLines: number
  /** Statuses other than Processed / Declined (rows skipped), with counts. */
  otherStatus: Record<string, number>
  /** Heads not in ORDER_HEADS / WALLET_HEADS (rows kept), with counts. */
  unknownHeads: Record<string, number>
  /** Order names that match no store prefix (rows kept with no store). */
  noStore: string[]
}

export function mapTransactions(records: Record<string, string>[], stores: { id: string; order_prefix: string }[]): { rows: TxnRow[]; report: TxnReport } {
  const need = ['Transaction ID', 'Transaction Date', 'Transaction Head', 'Transaction Nature', 'Transaction Status', 'Total Amt', 'Shopify Order Name']
  if (records.length > 0) {
    const missing = need.filter((c) => !(c in records[0]))
    if (missing.length) throw new Error(`not a vFulfill transactions export: missing ${missing.join(', ')}`)
  }
  const report: TxnReport = { rows: records.length, declined: { count: 0, paise: 0 }, itemLines: 0, otherStatus: {}, unknownHeads: {}, noStore: [] }
  const out = new Map<string, TxnRow>()
  for (const r of records) {
    const id = r['Transaction ID'].trim()
    const status = r['Transaction Status'].trim()
    const total = paiseOf(r['Total Amt'])
    if (isBlank(status) && total === null && isBlank(r['Transaction Nature'])) { report.itemLines++; continue }
    if (status === 'Declined') { report.declined.count++; report.declined.paise += total ?? 0; continue }
    if (status !== 'Processed') { report.otherStatus[status] = (report.otherStatus[status] ?? 0) + 1; continue }
    if (!id) throw new Error('processed vFulfill transaction with no Transaction ID')
    if (total === null) throw new Error(`${id}: processed with no Total Amt`)
    const natureRaw = r['Transaction Nature'].trim().toLowerCase()
    if (natureRaw !== 'debit' && natureRaw !== 'credit') throw new Error(`${id}: Transaction Nature ${JSON.stringify(r['Transaction Nature'])}`)
    if (total < 0) throw new Error(`${id}: negative Total Amt ${r['Total Amt']} (nature carries the sign)`)
    const date = vfDate(r['Transaction Date'])
    if (!date) throw new Error(`${id}: no Transaction Date`)
    const head = r['Transaction Head'].trim()
    if (!KNOWN.has(head)) report.unknownHeads[head] = (report.unknownHeads[head] ?? 0) + 1

    const orderName = text(r['Shopify Order Name'])
    const store = orderName ? storeForOrder(orderName, stores) : null
    if (orderName && !store) report.noStore.push(orderName)

    const row: TxnRow = {
      txn_id: id, txn_date: date, store_id: store, order_name: orderName, vf_order_id: text(r['VF Order ID']), head,
      nature: natureRaw, taxable_paise: paiseOf(r['Taxable Amt']), gst_paise: paiseOf(r['GST Amt']), total_paise: total, total_exact: exactOf(r['Total Amt']),
      particulars: text(r['Particulars']), remarks: text(r['Remarks']),
    }
    const prev = out.get(id)
    // The same ID twice with money on both would double-count: refuse rather than pick one.
    if (prev && (prev.total_exact !== row.total_exact || prev.nature !== row.nature || prev.head !== row.head)) {
      throw new Error(`${id}: listed twice with different amounts (${prev.total_paise} vs ${row.total_paise} paise)`)
    }
    out.set(id, prev ?? row)
  }
  return { rows: [...out.values()], report }
}

/**
 * Wallet balance in paise: credits − debits over the exact amounts, rounded once at the end (as vFulfill does;
 * rounding each row first drifts by a paisa every few hundred percentage-based fees).
 */
export function balanceOf(rows: Pick<TxnRow, 'nature' | 'total_exact'>[]): number {
  const m = rows.reduce((s, r) => s + (r.nature === 'credit' ? 1 : -1) * micros(r.total_exact), 0)
  return Math.round(m / 1e4)
}

/** Whether an import took the whole file in: no rows skipped for an unknown status, and something written. */
export const transactionsComplete = (report: Pick<TxnReport, 'otherStatus'>, written: number) =>
  written > 0 && Object.keys(report.otherStatus).length === 0
