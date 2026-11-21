import { describe, expect, it } from 'vitest'
import {
  buildOrders, deliveryRates, filterOrders, monthRangeIst, orderStats, orderStatus, rateOf, shiftMonth,
  type ChargeRow, type OrderRow, type ShipmentRow,
} from './orders'

const order = (name: string, over: Partial<OrderRow> = {}): OrderRow => ({
  storeId: 'oorvia', orderName: name, placedAt: '2026-10-05T10:00:00+05:30', payment: 'cod', gateways: [], totalPaise: 249_900,
  sku: 'OMS-1M', city: 'Pune', state: 'Maharashtra', cancelledAt: null, ...over,
})
const ship = (name: string, status: ShipmentRow['status'], over: Partial<ShipmentRow> = {}): ShipmentRow => ({
  storeId: 'oorvia', orderName: name, status, statusRaw: status === 'rto' ? 'Returned' : status === 'open' ? 'In Transit' : 'Delivered', closedOn: '2026-10-09', ...over,
})
const charge = (name: string, head: string, totalPaise: number, over: Partial<ChargeRow> = {}): ChargeRow => ({
  storeId: 'oorvia', orderName: name, head, nature: 'debit', totalPaise, ...over,
})

describe('orderStatus', () => {
  it('the shipment decides, even when Shopify cancelled the order (RTO)', () => {
    expect(orderStatus('2026-10-12T00:00:00Z', ship('#A', 'rto'))).toBe('rto')
    expect(orderStatus(null, ship('#A', 'open'))).toBe('in_transit')
    expect(orderStatus(null, ship('#A', 'delivered'))).toBe('delivered')
  })
  it('no shipment: cancelled before shipping, or not shipped yet', () => {
    expect(orderStatus('2026-10-06T00:00:00Z', undefined)).toBe('cancelled')
    expect(orderStatus(null, undefined)).toBe('not_shipped')
  })
})

describe('buildOrders', () => {
  const rows = buildOrders(
    [
      order('#OV1'),
      order('#OV2', { placedAt: '2026-10-06T23:45:00+05:30', cancelledAt: '2026-10-15T00:00:00Z' }),
      order('#1001', { storeId: 'kaiven', placedAt: '2026-10-05T04:00:00Z' }), // 09:30 IST, before #OV1's 10:00
      order('#1001', { storeId: 'selnova', placedAt: '2026-10-04T01:00:00+05:30' }),
    ],
    [ship('#OV1', 'delivered'), ship('#OV2', 'rto'), ship('#1001', 'rto', { storeId: 'selnova' })],
    [
      charge('#OV2', 'Forward Shipping', 7_080), charge('#OV2', 'RTO Shipping', 7_080), charge('#OV2', 'RTO Handling Fee', 2_360),
      charge('#OV2', 'COD Fees', 2_950), // not billed on an RTO's account: left out
      charge('#OV2', 'Lost Claims', 10_000, { nature: 'credit' }),
      charge('#OV1', 'Forward Shipping', 7_080), // delivered: no RTO charges shown
      charge('#1001', 'RTO Shipping', 5_000, { storeId: 'selnova' }),
    ],
  )

  it('newest first, dated in IST', () => {
    expect(rows.map((r) => `${r.storeId}${r.orderName}`)).toEqual(['oorvia#OV2', 'oorvia#OV1', 'kaiven#1001', 'selnova#1001'])
    expect(rows[0].date).toBe('2026-10-06')
  })

  it('RTO charges: the billed heads only, debits only, GST included; none on a delivered order', () => {
    expect(rows[0]).toMatchObject({ status: 'rto', statusRaw: 'Returned', rtoChargesPaise: 7_080 + 7_080 + 2_360 })
    expect(rows[1]).toMatchObject({ status: 'delivered', rtoChargesPaise: 0 })
  })

  it('matches shipments and charges by store as well as name (#1001 exists in two stores)', () => {
    expect(rows.find((r) => r.storeId === 'kaiven')).toMatchObject({ status: 'not_shipped', rtoChargesPaise: 0 })
    expect(rows.find((r) => r.storeId === 'selnova')).toMatchObject({ status: 'rto', rtoChargesPaise: 5_000 })
  })
})

describe('orderStats', () => {
  const rows = buildOrders(
    [order('#1'), order('#2'), order('#3'), order('#4', { cancelledAt: '2026-10-05T12:00:00Z' }), order('#5'), order('#6', { totalPaise: 100_000 })],
    [ship('#1', 'delivered'), ship('#2', 'delivered'), ship('#3', 'open'), ship('#6', 'rto')],
    [charge('#6', 'RTO Shipping', 7_080)],
  )
  it('counts every order but those cancelled before shipping; RTO rate over resolved orders', () => {
    expect(orderStats(rows)).toEqual({
      orders: 5, cancelled: 1, delivered: 2, rto: 1, inTransit: 1, notShipped: 1,
      rtoRate: 1 / 3, rtoShareOfAll: 1 / 5,
      bookedPaise: 4 * 249_900 + 100_000, rtoValuePaise: 100_000, rtoChargesPaise: 7_080,
    })
  })
  it('nothing resolved: rates are null, not 0', () => {
    expect(orderStats([])).toMatchObject({ orders: 0, rtoRate: null, rtoShareOfAll: null })
  })
})

describe('filterOrders', () => {
  const rows = buildOrders([order('#OV31197790', { payment: 'prepaid' }), order('#OV31190001')], [ship('#OV31190001', 'delivered')], [])
  it('by status, payment and order-name search, together', () => {
    expect(filterOrders(rows, { status: null, payment: 'prepaid', q: '' }).map((r) => r.orderName)).toEqual(['#OV31197790'])
    expect(filterOrders(rows, { status: 'delivered', payment: null, q: '' }).map((r) => r.orderName)).toEqual(['#OV31190001'])
    expect(filterOrders(rows, { status: null, payment: null, q: ' ov3119779 ' }).map((r) => r.orderName)).toEqual(['#OV31197790'])
    expect(filterOrders(rows, { status: 'rto', payment: null, q: '' })).toEqual([])
  })
})

describe('deliveryRates', () => {
  const rows = buildOrders(
    [
      order('#1', { state: 'Maharashtra' }), order('#2', { state: 'Maharashtra', payment: 'prepaid' }), order('#3', { state: 'Bihar' }),
      order('#4', { state: 'Bihar' }), order('#5', { state: 'Bihar', payment: 'unknown' }), order('#6', { state: null }),
    ],
    [ship('#1', 'delivered'), ship('#2', 'delivered'), ship('#3', 'rto'), ship('#4', 'delivered'), ship('#5', 'rto'), ship('#6', 'open')],
    [],
  )
  const byState = deliveryRates(rows, (o) => o.state ?? 'Unknown')

  it('resolved orders only, split by payment, unknown payment in the total only; most resolved first', () => {
    expect(byState).toEqual([
      { label: 'Bihar', cod: { delivered: 1, rto: 1 }, prepaid: { delivered: 0, rto: 0 }, all: { delivered: 1, rto: 2 } },
      { label: 'Maharashtra', cod: { delivered: 1, rto: 0 }, prepaid: { delivered: 1, rto: 0 }, all: { delivered: 2, rto: 0 } },
    ])
    expect(rateOf(byState[0].all)).toBeCloseTo(1 / 3)
    expect(rateOf(byState[0].prepaid)).toBeNull()
  })
})

describe('months', () => {
  it('shifts across a year and gives IST bounds', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(monthRangeIst('2026-11')).toEqual({ from: '2026-11-01T00:00:00+05:30', to: '2026-12-01T00:00:00+05:30' })
  })
})
