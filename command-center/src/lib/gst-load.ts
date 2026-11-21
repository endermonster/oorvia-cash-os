import 'server-only'
import { capitalSummary, type CapitalRow } from './capital'
import { computeGst, type GstEntry, type GstOrder, type GstResult, type GstSeed } from './gst'
import { selectAll } from './paged'
import { addMonths, type FixedCost } from './pnl'
import { istDate } from './pnl-load'
import { supabase } from './supabase'

type Num = number | string
const n = (v: Num) => Number(v)
const ym = (date: string) => date.slice(0, 7)

/** Manual GST entries and credit ledger balances, newest first: what /settings lists. */
export async function loadGstInputs() {
  const sb = supabase()
  const [entries, seeds] = await Promise.all([
    selectAll<{ id: Num; month: string; kind: GstEntry['kind']; source: string; description: string | null; taxable_paise: Num; rate: Num; gst_paise: Num; note: string | null }>(
      () => sb.from('cc_gst_entries').select('id, month, kind, source, description, taxable_paise, rate, gst_paise, note').order('month', { ascending: false }).order('id', { ascending: false })),
    selectAll<{ month: string; balance_paise: Num; note: string | null }>(
      () => sb.from('cc_gst_credit').select('month, balance_paise, note').order('month', { ascending: false })),
  ])
  return {
    entries: entries.map((e): GstEntry => ({
      id: n(e.id), month: ym(e.month), kind: e.kind, source: e.source, description: e.description,
      taxablePaise: n(e.taxable_paise), rate: n(e.rate), gstPaise: n(e.gst_paise), note: e.note,
    })),
    seeds: seeds.map((s): GstSeed => ({ month: ym(s.month), balancePaise: n(s.balance_paise), note: s.note })),
  }
}

/** Everything the GST estimate needs, from the month after the latest credit balance entered to `today`'s. */
export async function loadGst(today: string): Promise<GstResult> {
  const sb = supabase()
  const { entries, seeds } = await loadGstInputs()
  const current = ym(today)
  const latest = seeds.find((s) => s.month < current)
  const first = latest ? addMonths(latest.month, 1) : current
  const from = `${first}-01`

  const [stores, orders, shipments, txns, days, fixed] = await Promise.all([
    selectAll<{ id: string; gateway_pct: Num }>(() => sb.from('cc_stores').select('id, gateway_pct').order('id')),
    // Every order: one placed long ago can still be delivered in these months.
    selectAll<{ store_id: string; order_name: string; placed_at: string; payment: GstOrder['payment']; gateways: string[] | null; total_paise: Num; state: string | null }>(
      () => sb.from('cc_orders').select('store_id, order_name, placed_at, payment, gateways, total_paise, state').eq('is_test', false).order('store_id').order('order_name')),
    selectAll<{ store_id: string; order_name: string; closed_on: string }>(
      () => sb.from('cc_shipments').select('store_id, order_name, closed_on').eq('status', 'delivered').gte('closed_on', from).order('store_id').order('order_name')),
    selectAll<{ store_id: string | null; order_name: string | null; txn_date: string; head: string; nature: 'debit' | 'credit'; gst_paise: Num | null }>(
      () => sb.from('cc_vf_transactions').select('store_id, order_name, txn_date, head, nature, gst_paise').gte('txn_date', from).order('txn_id')),
    selectAll<{ campaign_id: string; date: string; spend_paise: Num }>(
      () => sb.from('cc_campaign_days').select('campaign_id, date, spend_paise').gte('date', from).order('campaign_id').order('date')),
    selectAll<{ store_id: string | null; name: string; amount_paise: Num; frequency: FixedCost['frequency']; start_date: string; end_date: string | null; gst_inclusive: boolean; rcm: boolean }>(
      () => sb.from('cc_fixed_costs').select('store_id, name, amount_paise, frequency, start_date, end_date, gst_inclusive, rcm').eq('rcm', true).order('id')),
  ])

  const delivered = new Map(shipments.map((s) => [`${s.store_id}|${s.order_name}`, s.closed_on]))
  return computeGst({
    orders: orders.map((o) => ({
      storeId: o.store_id, orderName: o.order_name, orderDate: istDate(o.placed_at), payment: o.payment, gateways: o.gateways ?? [],
      totalPaise: n(o.total_paise), state: o.state, deliveredOn: delivered.get(`${o.store_id}|${o.order_name}`) ?? null,
    })),
    txns: txns.map((t) => ({ storeId: t.store_id, orderName: t.order_name, txnDate: t.txn_date, head: t.head, nature: t.nature, gstPaise: t.gst_paise === null ? null : n(t.gst_paise) })),
    spend: days.map((d) => ({ date: d.date, spendPaise: n(d.spend_paise) })),
    fixed: fixed.map((f) => ({
      storeId: f.store_id, name: f.name, amountPaise: n(f.amount_paise), frequency: f.frequency, startDate: f.start_date, endDate: f.end_date, gstInclusive: f.gst_inclusive, rcm: f.rcm,
    })),
    entries, seeds, asOf: today, fromMonth: first,
    stores: stores.map((s) => ({ id: s.id, gatewayPct: n(s.gateway_pct) })),
  })
}

export async function loadCapitalRows(): Promise<CapitalRow[]> {
  const rows = await selectAll<{ id: Num; kind: CapitalRow['kind']; name: string; amount_paise: Num; received_on: string; interest_rate: Num | null; due_on: string | null; repaid_paise: Num; note: string | null }>(
    () => supabase().from('cc_capital').select('id, kind, name, amount_paise, received_on, interest_rate, due_on, repaid_paise, note').order('received_on').order('id'))
  return rows.map((r) => ({
    id: n(r.id), kind: r.kind, name: r.name, amountPaise: n(r.amount_paise), receivedOn: r.received_on,
    interestRate: r.interest_rate === null ? null : n(r.interest_rate), dueOn: r.due_on, repaidPaise: n(r.repaid_paise), note: r.note,
  }))
}

export async function loadCapital(today: string) {
  return capitalSummary(await loadCapitalRows(), today)
}
