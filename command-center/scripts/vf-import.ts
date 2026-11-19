// Imports vFulfill exports (every store at once: one vFulfill account).
// Run: NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/vf-import.ts \
//        [--shipments <export.csv>] [--transactions <export.csv>] [--dry-run]
// Shipments → cc_shipments: upserts by (store, order); never deletes, never lets an older file reopen a closed one.
// Transactions → cc_vf_transactions: upserts by Transaction ID; never deletes.
// Shipments run first, so the transactions report's COD checks see the new statuses.
// Each records one cc_sync_runs row (vf_shipments / vf_transactions, store null) unless --dry-run, which writes nothing.
// Exit 1 when anything is reported, 2 on bad usage.
import { readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { csvRecords } from '../src/lib/csv'
import { selectAll } from '../src/lib/paged'
import { supabase } from '../src/lib/supabase'
import { withRun } from '../src/lib/sync-run'
import { mapShipments, shipmentsComplete, wouldReopen, type ShipmentRow, type ShipmentStatus } from '../src/lib/vfulfill/shipments'
import { balanceOf, exactOf, mapTransactions, transactionsComplete, type TxnRow } from '../src/lib/vfulfill/transactions'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

type Store = { id: string; order_prefix: string }
const BATCH = 500
const list = (xs: string[], n = 10) => `${xs.slice(0, n).join(', ')}${xs.length > n ? ` … +${xs.length - n}` : ''}`
const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const key = (r: { store_id: string | null; order_name: string | null }) => `${r.store_id}|${r.order_name}`

async function upsertAll<T extends object>(sb: SupabaseClient, table: string, rows: T[], onConflict: string) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((r) => ({ ...r, imported_at: new Date().toISOString() }))
    const { error } = await sb.from(table).upsert(batch, { onConflict })
    if (error) throw new Error(`${table} upsert: ${error.message}`)
  }
}

/** Returns the statuses this file sets ("store|order" → status), so a combined dry run can reconcile against them. */
async function shipments(sb: SupabaseClient, file: string, stores: Store[], dryRun: boolean, reported: string[]): Promise<Map<string, ShipmentStatus>> {
  const { rows, report } = mapShipments(csvRecords(readFileSync(file, 'utf8')), stores)
  const stored = new Map((await selectAll<{ store_id: string; order_name: string; status: ShipmentStatus }>(
    () => sb.from('cc_shipments').select('store_id, order_name, status').order('store_id').order('order_name'),
  )).map((r) => [key(r), r.status]))
  const orders = new Set((await selectAll<{ store_id: string; order_name: string }>(
    () => sb.from('cc_orders').select('store_id, order_name').order('store_id').order('order_name'),
  )).map(key))

  const reopen = new Set(wouldReopen(rows, stored).map(key))
  const toWrite: ShipmentRow[] = rows.filter((r) => !reopen.has(key(r)))
  const notInOrders = rows.filter((r) => !orders.has(key(r))).map((r) => r.order_name)
  const byStore: Record<string, number> = {}
  for (const r of rows) byStore[r.store_id] = (byStore[r.store_id] ?? 0) + 1
  const closed = rows.map((r) => r.closed_on).filter((d): d is string => d !== null).sort()
  const isNew = toWrite.filter((r) => !stored.has(key(r))).length

  console.log(`\n== vFulfill shipments${dryRun ? ' (dry run: nothing is written)' : ''}`)
  console.log(`file rows ${report.rows}; shipments ${rows.length} by store ${JSON.stringify(byStore)}; by status ${JSON.stringify(report.byStatus)}`)
  console.log(`closed ${closed[0] ?? '-'} → ${closed.at(-1) ?? '-'}`)
  console.log(`would write ${toWrite.length} (${isNew} new, ${toWrite.length - isNew} updated)`)
  if (report.rtoDatedByMarked.length) console.log(`  RTO dated by RTO Marked On (no Closed On): ${list(report.rtoDatedByMarked)}`)
  const open = rows.filter((r) => r.status === 'open').map((r) => r.order_name)
  if (open.length) console.log(`  still open: ${list(open)}`)

  if (report.noStore.length) reported.push(`no store for order name: ${list(report.noStore)}`)
  for (const [s, n] of Object.entries(report.unknownStatus)) reported.push(`unknown Shipment Status ${JSON.stringify(s)} x${n} (skipped)`)
  if (report.duplicates.length) reported.push(`listed twice (last row kept): ${list(report.duplicates)}`)
  if (report.deliveredNoDate.length) reported.push(`Delivered with no Closed On (kept open): ${list(report.deliveredNoDate)}`)
  if (report.closedNoDate.length) reported.push(`RTO with no date at all (not counted in rates): ${list(report.closedNoDate)}`)
  if (reopen.size) reported.push(`not reopened (stored as closed, file says open): ${list([...reopen])}`)
  if (notInOrders.length) reported.push(`${notInOrders.length} shipment(s) with no Shopify order yet (stored; they count once the order exists): ${list(notInOrders)}`)

  const skipped = { unknown_status: report.unknownStatus, no_store: report.noStore }
  const complete = shipmentsComplete(report, toWrite.length)
  if (!dryRun) {
    await withRun('vf_shipments', null, async () => {
      await upsertAll(sb, 'cc_shipments', toWrite, 'store_id,order_name')
      return { file_rows: report.rows, written: toWrite.length, new: isNew, by_status: report.byStatus, skipped }
    }, () => complete)
    console.log(`written ${toWrite.length}${complete ? '' : ' (run recorded as not ok: rows were skipped or nothing was written)'}`)
  }
  return new Map(toWrite.map((r) => [key(r), r.status]))
}

/** `projected`: statuses from a shipments file in the same run, which win over the stored ones (a dry run stores none). */
async function transactions(sb: SupabaseClient, file: string, stores: Store[], dryRun: boolean, reported: string[], projected = new Map<string, ShipmentStatus>()) {
  const { rows, report } = mapTransactions(csvRecords(readFileSync(file, 'utf8')), stores)
  const stored = new Map((await selectAll<TxnRow>(
    () => sb.from('cc_vf_transactions').select('txn_id, txn_date, store_id, order_name, vf_order_id, head, nature, taxable_paise, gst_paise, total_paise, total_exact, particulars, remarks').order('txn_id'),
  )).map((r) => [r.txn_id, r]))
  const changed = rows.filter((r) => { const s = stored.get(r.txn_id); return s && (s.total_exact === null || exactOf(String(s.total_exact)) !== r.total_exact || s.nature !== r.nature || s.head !== r.head) })
  const isNew = rows.filter((r) => !stored.has(r.txn_id)).length

  // After import, the ledger is what is stored plus this file (an ID in both takes the file's version).
  // total_exact comes back as a JSON number (or null on rows imported before the column existed): normalise it.
  const ledger = new Map([...stored].map(([id, r]) => [id, {
    ...r, total_paise: Number(r.total_paise), total_exact: r.total_exact === null ? (Number(r.total_paise) / 100).toFixed(2) : exactOf(String(r.total_exact)),
  }]))
  for (const r of rows) ledger.set(r.txn_id, r)
  const all = [...ledger.values()]
  const dates = rows.map((r) => r.txn_date).sort()

  const orders = new Map((await selectAll<{ store_id: string; order_name: string; payment: string; total_paise: number | string; cancelled_at: string | null }>(
    () => sb.from('cc_orders').select('store_id, order_name, payment, total_paise, cancelled_at').order('store_id').order('order_name'),
  )).map((r) => [key(r), r]))
  const ships = new Map((await selectAll<{ store_id: string; order_name: string; status: ShipmentStatus }>(
    () => sb.from('cc_shipments').select('store_id, order_name, status').order('store_id').order('order_name'),
  )).map((r) => [key(r), r.status]))
  for (const [k, s] of projected) ships.set(k, s)

  const orderRows = all.filter((r) => r.order_name !== null)
  const notInOrders = [...new Set(orderRows.filter((r) => r.store_id && !orders.has(key(r))).map((r) => r.order_name!))]
  const remitted = new Map<string, number>()
  for (const r of all) if (r.head === 'COD Remittance' && r.nature === 'credit') remitted.set(key(r), (remitted.get(key(r)) ?? 0) + r.total_paise)

  // COD due: Shopify-COD orders vFulfill delivered with no remittance yet. Payment from Shopify, status from shipments.
  const due = [...ships].filter(([k, s]) => s === 'delivered' && orders.get(k)?.payment === 'cod' && !remitted.has(k))
  const duePaise = due.reduce((s, [k]) => s + Number(orders.get(k)!.total_paise), 0)
  const staleOpen = [...remitted].filter(([k, p]) => p > 0 && ships.get(k) === 'open').map(([k]) => k.split('|')[1])
  const remitNotCod = [...remitted].filter(([k, p]) => p > 0 && orders.has(k) && orders.get(k)!.payment === 'prepaid').map(([k]) => k.split('|')[1])

  const byHead = new Map<string, { n: number; paise: number; nature: string }>()
  for (const r of rows) {
    const h = byHead.get(r.head) ?? { n: 0, paise: 0, nature: r.nature }
    h.n++; h.paise += r.total_paise
    byHead.set(r.head, h)
  }

  console.log(`\n== vFulfill transactions${dryRun ? ' (dry run: nothing is written)' : ''}`)
  console.log(`file rows ${report.rows}; transactions ${rows.length} (${dates[0] ?? '-'} → ${dates.at(-1) ?? '-'}); item lines skipped ${report.itemLines}; declined skipped ${report.declined.count} (${inr(report.declined.paise)})`)
  console.log(`would write ${rows.length} (${isNew} new, ${rows.length - isNew} already stored, ${changed.length} changed)`)
  for (const [head, h] of [...byHead].sort((a, b) => b[1].paise - a[1].paise)) console.log(`  ${head.padEnd(30)} ${h.nature.padEnd(6)} ${String(h.n).padStart(5)}  ${inr(h.paise)}`)
  console.log(`vFulfill wallet after import: ${inr(balanceOf(all))} (credits − debits, ${all.length} transactions)`)
  console.log(`COD due (delivered Shopify-COD orders not yet remitted): ${inr(duePaise)} over ${due.length} order(s)${due.length ? `: ${list(due.map(([k]) => k.split('|')[1]))}` : ''}`)

  for (const [h, n] of Object.entries(report.unknownHeads)) reported.push(`unknown Transaction Head ${JSON.stringify(h)} x${n} (stored; not classified)`)
  for (const [s, n] of Object.entries(report.otherStatus)) reported.push(`Transaction Status ${JSON.stringify(s)} x${n} (skipped)`)
  if (report.noStore.length) reported.push(`no store for order name: ${list([...new Set(report.noStore)])}`)
  if (changed.length) reported.push(`${changed.length} stored transaction(s) changed amount, nature or head: ${list(changed.map((r) => r.txn_id))}`)
  if (notInOrders.length) reported.push(`${notInOrders.length} order(s) with charges but no Shopify order: ${list(notInOrders)}`)
  if (staleOpen.length) reported.push(`remitted but the shipment is still open (vFulfill status is stale; export shipments again): ${list(staleOpen)}`)
  if (remitNotCod.length) reported.push(`COD remittance on an order Shopify says is prepaid: ${list(remitNotCod)}`)

  if (!dryRun) {
    await withRun('vf_transactions', null, async () => {
      await upsertAll(sb, 'cc_vf_transactions', rows, 'txn_id')
      return { file_rows: report.rows, written: rows.length, new: isNew, changed: changed.length, wallet_paise: balanceOf(all), cod_due_paise: duePaise, skipped: { status: report.otherStatus } }
    }, () => transactionsComplete(report, rows.length))
    console.log(`written ${rows.length}`)
  }
}

async function main() {
  const shipFile = arg('shipments'), txnFile = arg('transactions')
  const dryRun = process.argv.includes('--dry-run')
  if (!shipFile && !txnFile) { console.error('Usage: [--shipments <export.csv>] [--transactions <export.csv>] [--dry-run]'); process.exit(2) }
  const sb = supabase()
  const stores = await selectAll<Store>(() => sb.from('cc_stores').select('id, order_prefix').order('id'))
  const reported: string[] = []
  const projected = shipFile ? await shipments(sb, shipFile, stores, dryRun, reported) : undefined
  if (txnFile) await transactions(sb, txnFile, stores, dryRun, reported, projected)

  if (reported.length) {
    console.log(`\n${reported.length} item(s) reported:`)
    for (const s of reported) console.log(`  - ${s}`)
    process.exit(1)
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
