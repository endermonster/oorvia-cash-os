import 'server-only'
import type { Baseline } from './forecast'
import { selectAll } from './paged'
import { computePnl, orderCogs, type CogsEntry, type FixedCost, type OrderLine, type PnlOrder, type PnlResult, type PnlTxn } from './pnl'
import { supabase } from './supabase'

type Num = number | string
const n = (v: Num) => Number(v)

/** A timestamp's calendar date in India (UTC+5:30, no DST), as the cc_order_facts view computes it. */
export const istDate = (ts: string) => new Date(Date.parse(ts) + 5.5 * 3_600_000).toISOString().slice(0, 10)

/** Reads everything the monthly P&L needs (paged: no read can be cut off at the row cap) and computes it. */
export async function loadPnl(fromMonth: string, toMonth: string, asOf?: string): Promise<PnlResult> {
  const sb = supabase()
  const [stores, orders, lines, history, shipments, txns, days, campaigns, fixed] = await Promise.all([
    selectAll<{ id: string; gateway_pct: Num; owner_share: Num; live_since: string | null }>(() => sb.from('cc_stores').select('id, gateway_pct, owner_share, live_since').order('id')),
    selectAll<{ store_id: string; order_name: string; placed_at: string; payment: PnlOrder['payment']; gateways: string[] | null; total_paise: Num; cancelled_at: string | null }>(
      () => sb.from('cc_orders').select('store_id, order_name, placed_at, payment, gateways, total_paise, cancelled_at').eq('is_test', false).order('store_id').order('order_name'),
    ),
    // Lines and costs, not cc_order_facts: that view drops cancelled orders, and Shopify marks some delivered orders cancelled.
    selectAll<OrderLine & { qty: Num }>(() => sb.from('cc_order_lines').select('store_id, order_name, sku, qty, shopify_product_id').order('store_id').order('order_name').order('line_no')),
    selectAll<CogsEntry & { cogs_paise: Num }>(() => sb.from('cc_cogs_history').select('store_id, sku, cogs_paise, effective_from').order('store_id').order('sku').order('effective_from')),
    selectAll<{ store_id: string; order_name: string; status: string; closed_on: string | null }>(
      () => sb.from('cc_shipments').select('store_id, order_name, status, closed_on').order('store_id').order('order_name'),
    ),
    selectAll<{ store_id: string | null; order_name: string | null; txn_date: string; head: string; nature: 'debit' | 'credit'; taxable_paise: Num | null; total_paise: Num }>(
      () => sb.from('cc_vf_transactions').select('store_id, order_name, txn_date, head, nature, taxable_paise, total_paise').order('txn_id'),
    ),
    selectAll<{ campaign_id: string; date: string; spend_paise: Num }>(() => sb.from('cc_campaign_days').select('campaign_id, date, spend_paise').order('campaign_id').order('date')),
    selectAll<{ campaign_id: string; store_id: string }>(() => sb.from('cc_campaigns').select('campaign_id, store_id').order('campaign_id')),
    selectAll<{ store_id: string | null; name: string; amount_paise: Num; frequency: FixedCost['frequency']; start_date: string; end_date: string | null; gst_inclusive: boolean }>(
      () => sb.from('cc_fixed_costs').select('store_id, name, amount_paise, frequency, start_date, end_date, gst_inclusive').order('id'),
    ),
  ])

  const key = (s: string, o: string) => `${s}|${o}`
  const cogsBy = orderCogs(
    orders.map((o) => ({ storeId: o.store_id, orderName: o.order_name, date: istDate(o.placed_at) })),
    lines.map((l) => ({ ...l, qty: n(l.qty) })),
    history.map((h) => ({ ...h, cogs_paise: n(h.cogs_paise) })),
  )
  const shipBy = new Map(shipments.map((s) => [key(s.store_id, s.order_name), s]))
  const storeOf = new Map(campaigns.map((c) => [c.campaign_id, c.store_id]))

  const pnlOrders: PnlOrder[] = orders.map((o) => {
    const c = cogsBy.get(key(o.store_id, o.order_name))
    const s = shipBy.get(key(o.store_id, o.order_name))
    const status = s?.status
    return {
      storeId: o.store_id, orderName: o.order_name, orderDate: istDate(o.placed_at), payment: o.payment, gateways: o.gateways ?? [],
      totalPaise: n(o.total_paise), cancelled: o.cancelled_at !== null,
      shipStatus: status === 'delivered' || status === 'rto' || status === 'open' ? status : null, closedOn: s?.closed_on ?? null,
      cogsPaise: c?.cogsPaise ?? 0, cogsKnown: c?.cogsKnown ?? true,
    }
  })
  const pnlTxns: PnlTxn[] = txns.map((t) => ({
    storeId: t.store_id, orderName: t.order_name, txnDate: t.txn_date, head: t.head, nature: t.nature,
    taxablePaise: t.taxable_paise === null ? null : n(t.taxable_paise), totalPaise: n(t.total_paise),
  }))
  const unmapped = new Set<string>()
  const spend = days.flatMap((d) => {
    const storeId = storeOf.get(d.campaign_id)
    if (!storeId) { unmapped.add(d.campaign_id); return [] }
    return [{ storeId, date: d.date, spendPaise: n(d.spend_paise) }]
  })

  const result = computePnl({
    stores: stores.map((s) => ({ id: s.id, gatewayPct: n(s.gateway_pct), ownerShare: n(s.owner_share), liveSince: s.live_since ?? undefined })),
    orders: pnlOrders, txns: pnlTxns, spend,
    fixed: fixed.map((f) => ({
      storeId: f.store_id, name: f.name, amountPaise: n(f.amount_paise), frequency: f.frequency, startDate: f.start_date, endDate: f.end_date, gstInclusive: f.gst_inclusive,
    })),
    fromMonth, toMonth, asOf,
  })
  if (unmapped.size > 0) result.warnings.push(`Ad spend from ${unmapped.size} campaign${unmapped.size === 1 ? '' : 's'} with no store left out`)
  return result
}

/** Each store's result before its first P&L month (Oorvia's pre-GST loss), for the Forecast. */
export async function loadBaselines(): Promise<Baseline[]> {
  const rows = await selectAll<{ store_id: string; period_end: string; net_paise: Num; note: string | null }>(
    () => supabase().from('cc_pnl_baseline').select('store_id, period_end, net_paise, note').order('store_id'))
  return rows.map((r) => ({ storeId: r.store_id, periodEnd: r.period_end, netPaise: n(r.net_paise), note: r.note }))
}
