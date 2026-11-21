/**
 * The Orders tab: one month of orders across stores, their delivery outcome and RTO charges. Pure; the loader is
 * ./orders-load.ts. Ported from old Cash OS `/orders` and `/rto` (2026-11-21) onto the cc_* tables.
 *
 * - **The shipment decides the status** (vFulfill shipments export), never Shopify: Shopify marks RTO'd orders
 *   cancelled. With no shipment, a cancelled order was cancelled before shipping; otherwise it has not shipped (or
 *   the export is older than its shipment).
 * - RTO charges are vFulfill's debits under the heads it bills on an RTO (old Cash OS `/api/rto-costs`), GST
 *   included as billed. COD fees are not among them: vFulfill does not charge COD fees on an RTO.
 * - An order belongs to the month it was placed, in IST.
 * - Old Cash OS could edit, delete and "mark delivered" orders. Not ported: Shopify and vFulfill own this data.
 */

export type OrderStatus = 'delivered' | 'rto' | 'in_transit' | 'not_shipped' | 'cancelled'
export type OrderPayment = 'cod' | 'prepaid' | 'unknown'

export const STATUS_LABEL: Record<OrderStatus, string> = {
  delivered: 'Delivered', rto: 'RTO', in_transit: 'In transit', not_shipped: 'Not shipped', cancelled: 'Cancelled',
}

/** vFulfill heads billed on an order that comes back (lower case; vFulfill spells "Managment"). */
export const RTO_CHARGE_HEADS = new Set([
  'forward shipping', 'fulfilment fees', 'fulfillment fees', 'order managment fee', 'order management fee',
  'convenience fees percentage', 'rto handling fee', 'rto shipping',
])

export type OrderRow = {
  storeId: string
  orderName: string
  placedAt: string
  payment: OrderPayment
  gateways: string[]
  totalPaise: number
  sku: string | null
  city: string | null
  state: string | null
  cancelledAt: string | null
}
export type ShipmentRow = { storeId: string; orderName: string; status: 'delivered' | 'rto' | 'open'; statusRaw: string | null; closedOn: string | null }
export type ChargeRow = { storeId: string | null; orderName: string | null; head: string; nature: 'debit' | 'credit'; totalPaise: number }

export type OrderView = OrderRow & {
  /** Placed date, IST. */
  date: string
  status: OrderStatus
  /** vFulfill's own words ("Returned", "Lost", "In Transit"). */
  statusRaw: string | null
  closedOn: string | null
  /** RTO orders only: what vFulfill billed on it, GST included. */
  rtoChargesPaise: number
}

const key = (storeId: string | null, orderName: string | null) => `${storeId}|${orderName}`
export const istDate = (ts: string) => new Date(Date.parse(ts) + 5.5 * 3_600_000).toISOString().slice(0, 10)

export function orderStatus(cancelledAt: string | null, ship: ShipmentRow | undefined): OrderStatus {
  if (ship) return ship.status === 'open' ? 'in_transit' : ship.status
  return cancelledAt ? 'cancelled' : 'not_shipped'
}

/** Orders joined to their shipment and RTO charges, newest first. */
export function buildOrders(orders: OrderRow[], shipments: ShipmentRow[], charges: ChargeRow[]): OrderView[] {
  const ships = new Map(shipments.map((s) => [key(s.storeId, s.orderName), s]))
  const rto = new Map<string, number>()
  for (const c of charges) {
    if (c.nature !== 'debit' || !RTO_CHARGE_HEADS.has(c.head.trim().toLowerCase())) continue
    const k = key(c.storeId, c.orderName)
    rto.set(k, (rto.get(k) ?? 0) + c.totalPaise)
  }
  return orders
    .map((o) => {
      const ship = ships.get(key(o.storeId, o.orderName))
      const status = orderStatus(o.cancelledAt, ship)
      return {
        ...o, date: istDate(o.placedAt), status, statusRaw: ship?.statusRaw ?? null, closedOn: ship?.closedOn ?? null,
        rtoChargesPaise: status === 'rto' ? (rto.get(key(o.storeId, o.orderName)) ?? 0) : 0,
      }
    })
    .sort((a, b) => Date.parse(b.placedAt) - Date.parse(a.placedAt) || a.orderName.localeCompare(b.orderName))
}

export type OrderFilter = { status: OrderStatus | null; payment: OrderPayment | null; q: string }

export function filterOrders(rows: OrderView[], f: OrderFilter): OrderView[] {
  const q = f.q.trim().toLowerCase()
  return rows.filter((o) =>
    (!f.status || o.status === f.status) && (!f.payment || o.payment === f.payment) && (!q || o.orderName.toLowerCase().includes(q)))
}

export type OrderStats = {
  /** Every order except those cancelled before shipping (old Cash OS never imported them). */
  orders: number
  cancelled: number
  delivered: number
  rto: number
  inTransit: number
  notShipped: number
  /** RTO ÷ (delivered + RTO): how often a shipment that resolved came back. Null with nothing resolved. */
  rtoRate: number | null
  /** RTO ÷ all orders, as old Cash OS showed it. */
  rtoShareOfAll: number | null
  bookedPaise: number
  /** RTO orders' value: revenue that never arrived. */
  rtoValuePaise: number
  rtoChargesPaise: number
}

export function orderStats(rows: OrderView[]): OrderStats {
  const counted = rows.filter((o) => o.status !== 'cancelled')
  const n = (s: OrderStatus) => rows.filter((o) => o.status === s).length
  const delivered = n('delivered')
  const rto = n('rto')
  const rtoRows = rows.filter((o) => o.status === 'rto')
  return {
    orders: counted.length, cancelled: n('cancelled'), delivered, rto, inTransit: n('in_transit'), notShipped: n('not_shipped'),
    rtoRate: delivered + rto > 0 ? rto / (delivered + rto) : null,
    rtoShareOfAll: counted.length > 0 ? rto / counted.length : null,
    bookedPaise: counted.reduce((s, o) => s + o.totalPaise, 0),
    rtoValuePaise: rtoRows.reduce((s, o) => s + o.totalPaise, 0),
    rtoChargesPaise: rtoRows.reduce((s, o) => s + o.rtoChargesPaise, 0),
  }
}

export type Outcome = { delivered: number; rto: number }
export type RateRow = { label: string; cod: Outcome; prepaid: Outcome; all: Outcome }

const empty = (): Outcome => ({ delivered: 0, rto: 0 })
export const rateOf = (o: Outcome) => (o.delivered + o.rto > 0 ? o.delivered / (o.delivered + o.rto) : null)

/**
 * Delivered vs RTO among resolved orders, grouped by `by`, split by payment type. Unknown payment counts in `all`
 * only. Most resolved first.
 */
export function deliveryRates(rows: OrderView[], by: (o: OrderView) => string): RateRow[] {
  const groups = new Map<string, RateRow>()
  for (const o of rows) {
    if (o.status !== 'delivered' && o.status !== 'rto') continue
    const label = by(o)
    const g = groups.get(label) ?? { label, cod: empty(), prepaid: empty(), all: empty() }
    const field = o.status === 'delivered' ? 'delivered' : 'rto'
    g.all[field]++
    if (o.payment === 'cod' || o.payment === 'prepaid') g[o.payment][field]++
    groups.set(label, g)
  }
  const total = (r: RateRow) => r.all.delivered + r.all.rto
  return [...groups.values()].sort((a, b) => total(b) - total(a) || a.label.localeCompare(b.label))
}

/** YYYY-MM plus `n` months. */
export function shiftMonth(month: string, n: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** The month's bounds as timestamps at IST midnight, for a placed_at range read. */
export function monthRangeIst(month: string): { from: string; to: string } {
  return { from: `${month}-01T00:00:00+05:30`, to: `${shiftMonth(month, 1)}-01T00:00:00+05:30` }
}
