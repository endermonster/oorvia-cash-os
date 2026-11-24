import 'server-only'
import { readShipmentCoverage, shipmentCutoffs } from './load'
import { buildOrders, monthRangeIst, type ChargeRow, type OrderPayment, type OrderRow, type OrderView, type ShipmentRow } from './orders'
import { selectAll } from './paged'
import { supabase } from './supabase'

type Num = number | string
/** Order names per `.in()` read: keeps the URL short (PostgREST serialises the list into it). */
const CHUNK = 100

function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK))
  return out
}

/**
 * One month of real orders (placed in that IST month) for the given stores, with their shipments and, for RTOs,
 * vFulfill's charges. Test orders are left out. Shipments and charges are read by order name and matched by store
 * too, since two stores can share a name (#1001).
 */
export async function loadOrdersMonth(month: string, storeIds: string[]): Promise<OrderView[]> {
  const sb = supabase()
  const { from, to } = monthRangeIst(month)
  const [orders, coverage] = await Promise.all([
    selectAll<{
      store_id: string; order_name: string; placed_at: string; payment: OrderPayment; gateways: string[] | null; total_paise: Num
      primary_sku: string | null; city: string | null; state: string | null; cancelled_at: string | null
    }>(() => sb.from('cc_orders')
      .select('store_id, order_name, placed_at, payment, gateways, total_paise, primary_sku, city, state, cancelled_at')
      .eq('is_test', false).in('store_id', storeIds).gte('placed_at', from).lt('placed_at', to)
      .order('store_id').order('order_name')),
    readShipmentCoverage(sb, storeIds),
  ])

  const rows: OrderRow[] = orders.map((o) => ({
    storeId: o.store_id, orderName: o.order_name, placedAt: o.placed_at, payment: o.payment, gateways: o.gateways ?? [],
    totalPaise: Number(o.total_paise), sku: o.primary_sku, city: o.city, state: o.state, cancelledAt: o.cancelled_at,
  }))
  const names = [...new Set(rows.map((o) => o.orderName))]

  const shipments: ShipmentRow[] = []
  for (const part of chunks(names)) {
    const got = await selectAll<{ store_id: string; order_name: string; status: ShipmentRow['status']; vf_status_raw: string | null; closed_on: string | null }>(
      () => sb.from('cc_shipments').select('store_id, order_name, status, vf_status_raw, closed_on').in('order_name', part).order('store_id').order('order_name'),
    )
    shipments.push(...got.map((s) => ({ storeId: s.store_id, orderName: s.order_name, status: s.status, statusRaw: s.vf_status_raw, closedOn: s.closed_on })))
  }

  // Charges only matter on RTOs: read just those orders'.
  const rtoKeys = new Set(shipments.filter((s) => s.status === 'rto').map((s) => `${s.storeId}|${s.orderName}`))
  const rtoNames = [...new Set(shipments.filter((s) => s.status === 'rto').map((s) => s.orderName))]
  const charges: ChargeRow[] = []
  for (const part of chunks(rtoNames)) {
    const got = await selectAll<{ store_id: string | null; order_name: string | null; head: string; nature: 'debit' | 'credit'; total_paise: Num }>(
      () => sb.from('cc_vf_transactions').select('store_id, order_name, head, nature, total_paise').in('order_name', part).eq('nature', 'debit').order('txn_id'),
    )
    charges.push(...got.filter((c) => rtoKeys.has(`${c.store_id}|${c.order_name}`))
      .map((c) => ({ storeId: c.store_id, orderName: c.order_name, head: c.head, nature: c.nature, totalPaise: Number(c.total_paise) })))
  }

  return buildOrders(rows, shipments, charges, shipmentCutoffs(coverage))
}
