import { describe, expect, it } from 'vitest'
import { coverageChecks, mapShipments, shipmentsComplete, storeForOrder, storesMissingFromFile, vfDate, vfStatus, wouldReopen, type ShipmentStatus } from './shipments'

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

describe('storesMissingFromFile', () => {
  const now = new Date('2026-11-24T06:00:00Z')
  const o = (store_id: string, placed_at: string, over: { cancelled_at?: string | null; is_test?: boolean } = {}) =>
    ({ store_id, placed_at, cancelled_at: null, is_test: false, ...over })
  const rows = [{ store_id: 'oorvia', closed_on: '2026-11-10' }, { store_id: 'oorvia', closed_on: null }]
  const stores = ['oorvia', 'kaiven', 'selnova']

  it('names a store with no rows that has real orders in the window (from the earliest closed date to 3 days ago)', () => {
    expect(storesMissingFromFile(rows, stores, [
      o('kaiven', '2026-11-17T10:00:00+05:30'), o('kaiven', '2026-11-18T10:00:00+05:30'),
      o('kaiven', '2026-11-23T10:00:00+05:30'), // too new to have shipped
      o('kaiven', '2026-11-05T10:00:00+05:30'), // before the file's range
      o('selnova', '2026-11-17T10:00:00+05:30', { cancelled_at: '2026-11-17T12:00:00Z' }),
      o('selnova', '2026-11-17T10:00:00+05:30', { is_test: true }),
    ], now)).toEqual([{ storeId: 'kaiven', orders: 2 }])
  })

  it('never names a store with no vFulfill history (not in historyStoreIds)', () => {
    expect(storesMissingFromFile(rows, ['oorvia'], [o('kaiven', '2026-11-17T10:00:00+05:30')], now)).toEqual([])
  })

  it('says nothing for a file with no closed shipment, or a store that is in the file', () => {
    expect(storesMissingFromFile([{ store_id: 'oorvia', closed_on: null }], stores, [o('kaiven', '2026-11-17T10:00:00+05:30')], now)).toEqual([])
    expect(storesMissingFromFile([...rows, { store_id: 'kaiven', closed_on: null }], stores, [o('kaiven', '2026-11-17T10:00:00+05:30')], now)).toEqual([])
  })
})

describe('coverageChecks', () => {
  it('checks stores last imported on an earlier IST day, up to 3 days before the newest import', () => {
    expect(coverageChecks({
      oorvia: '2026-11-24T05:00:00Z', kaiven: '2026-11-15T05:00:00Z',
      selnova: '2026-11-23T05:00:00Z', // a day behind: inside the lag, nothing should be expected yet
    })).toEqual([{ storeId: 'kaiven', seenAt: '2026-11-15T05:00:00Z', to: '2026-11-21T05:00:00.000Z' }])
  })

  it('checks nothing when every store was in the same day import, or there are no rows', () => {
    expect(coverageChecks({ oorvia: '2026-11-24T05:00:00Z', kaiven: '2026-11-24T04:00:00Z' })).toEqual([])
    expect(coverageChecks({})).toEqual([])
  })
})
