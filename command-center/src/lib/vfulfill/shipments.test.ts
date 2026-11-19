import { describe, expect, it } from 'vitest'
import { mapShipments, shipmentsComplete, storeForOrder, vfDate, vfStatus, wouldReopen, type ShipmentStatus } from './shipments'

const STORES = [{ id: 'oorvia', order_prefix: '#OV' }, { id: 'kaiven', order_prefix: '#KAI' }, { id: 'selnova', order_prefix: '#SN' }]
const row = (name: string, status: string, closed = 'N/A', marked = 'N/A') =>
  ({ 'Shopify Order name': name, 'Shipment Status': status, 'Closed On': closed, 'RTO Marked On': marked, 'Shopify Order Type': 'Prepaid' })

describe('vFulfill shipment fields', () => {
  it('maps every known status, and nothing else', () => {
    expect(['Delivered', 'Returned', 'RTO In-Transit', 'Lost', 'NDR', 'In Transit'].map(vfStatus)).toEqual(['delivered', 'rto', 'rto', 'rto', 'open', 'open'])
    expect(vfStatus('Cancelled')).toBeNull()
  })
  it('dates: ISO and DD-MM-YYYY, blank as null, anything else refused', () => {
    expect(vfDate('2026-08-21 15:03:00')).toBe('2026-08-21')
    expect(vfDate('21-08-2026 15:03')).toBe('2026-08-21')
    expect([vfDate('N/A'), vfDate('-'), vfDate('')]).toEqual([null, null, null])
    expect(() => vfDate('Aug 21')).toThrow()
  })
  it('store by order prefix, which must be followed by the number', () => {
    expect(storeForOrder('#OV31195990', STORES)).toBe('oorvia')
    expect(storeForOrder('#KAI1004', STORES)).toBe('kaiven')
    expect(storeForOrder('#1001', STORES)).toBeNull()
    expect(storeForOrder('#OVX12', STORES)).toBeNull()
  })
})

describe('mapShipments', () => {
  it('Delivered takes Closed On as the delivery date', () => {
    const { rows } = mapShipments([row('#OV1', 'Delivered', '2026-08-21 15:03:00')], STORES)
    expect(rows).toEqual([{ store_id: 'oorvia', order_name: '#OV1', status: 'delivered', vf_status_raw: 'Delivered', closed_on: '2026-08-21' }])
  })
  it('Delivered with no Closed On stays open and is reported', () => {
    const { rows, report } = mapShipments([row('#OV2', 'Delivered')], STORES)
    expect(rows[0]).toMatchObject({ status: 'open', closed_on: null })
    expect(report.deliveredNoDate).toEqual(['#OV2'])
  })
  it('Lost has no Closed On: it is an RTO dated by RTO Marked On', () => {
    const { rows, report } = mapShipments([row('#OV3', 'Lost', 'N/A', '2026-08-07 01:34:22')], STORES)
    expect(rows[0]).toMatchObject({ status: 'rto', closed_on: '2026-08-07' })
    expect(report.rtoDatedByMarked).toEqual(['#OV3'])
  })
  it('In Transit is open with no close date', () => {
    expect(mapShipments([row('#OV4', 'In Transit')], STORES).rows[0]).toMatchObject({ status: 'open', closed_on: null })
  })
  it('reports orders with no store, unknown statuses and duplicates (last row wins)', () => {
    const { rows, report } = mapShipments([
      row('#1001', 'Delivered', '2026-08-01'), row('#OV5', 'Weird'), row('#OV6', 'In Transit'), row('#OV6', 'Delivered', '2026-08-02'),
    ], STORES)
    expect(report.noStore).toEqual(['#1001'])
    expect(report.unknownStatus).toEqual({ Weird: 1 })
    expect(report.duplicates).toEqual(['#OV6'])
    expect(rows).toEqual([expect.objectContaining({ order_name: '#OV6', status: 'delivered' })])
    expect(report.byStatus).toEqual({ delivered: 1 })
  })
  it('refuses a file that is not a shipments export', () => {
    expect(() => mapShipments([{ 'Transaction ID': 'x' }], STORES)).toThrow(/not a vFulfill shipments export/)
  })
})

describe('wouldReopen', () => {
  it('an older file cannot reopen a shipment already closed', () => {
    const stored = new Map<string, ShipmentStatus>([['oorvia|#OV7', 'delivered'], ['oorvia|#OV8', 'open']])
    const { rows } = mapShipments([row('#OV7', 'In Transit'), row('#OV8', 'In Transit'), row('#OV9', 'In Transit')], STORES)
    expect(wouldReopen(rows, stored).map((r) => r.order_name)).toEqual(['#OV7'])
  })
})

describe('shipmentsComplete', () => {
  it('a file with unreadable rows, or nothing written, is not a complete import (it must not mark vFulfill fresh)', () => {
    const ok = mapShipments([row('#OV10', 'Delivered', '2026-08-01')], STORES)
    expect(shipmentsComplete(ok.report, ok.rows.length)).toBe(true)
    const odd = mapShipments([row('#OV11', 'Delivered', '2026-08-01'), row('#OV12', 'Weird')], STORES)
    expect(shipmentsComplete(odd.report, odd.rows.length)).toBe(false)
    const noStore = mapShipments([row('#OV13', 'Delivered', '2026-08-01'), row('#1001', 'Delivered', '2026-08-01')], STORES)
    expect(shipmentsComplete(noStore.report, noStore.rows.length)).toBe(false)
    expect(shipmentsComplete(ok.report, 0)).toBe(false)
  })
})
