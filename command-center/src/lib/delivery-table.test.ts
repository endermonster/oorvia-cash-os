import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import { createMetrics } from './metrics'
import { MOCK } from './mock'
import type { ResolvedDay } from './types'

const T = MOCK.today
const r = (sku: string, payment: ResolvedDay['payment'], daysAgo: number, delivered: number, rto: number): ResolvedDay =>
  ({ closedOn: addDays(T, -daysAgo), storeId: 'oorvia', sku, payment, delivered, rto })

describe('deliveryTable', () => {
  const m = createMetrics({ ...MOCK, resolved: [
    r('ZZ1', 'cod', 0, 3, 1), r('ZZ1', 'prepaid', 20, 2, 0), r('ZZ1', 'unknown', 100, 1, 0), r('ZZ2', 'cod', 6, 1, 1),
    { ...r('ZZ1', 'cod', 0, 50, 50), storeId: 'kaiven' }, r('ZZ3', 'cod', -1, 9, 9),
  ] })
  const rows = m.deliveryTable('oorvia')

  it('lists products with closed shipments, most first, then the store total', () => {
    expect(rows.map((x) => x.sku)).toEqual(['ZZ1', 'ZZ2', null]) // ZZ3 closes tomorrow: not listed
    expect(rows[0].name).toBe('ZZ1') // no product set up: the SKU stands in for the name
  })

  it('counts each window by close date, and never another store or a future date', () => {
    const zz1 = rows[0].cells
    expect(zz1['7d'].cod).toEqual({ delivered: 3, rto: 1 })
    expect(zz1['7d'].prepaid).toEqual({ delivered: 0, rto: 0 })
    expect(zz1['30d'].prepaid).toEqual({ delivered: 2, rto: 0 })
    expect(zz1.lifetime.all).toEqual({ delivered: 6, rto: 1 }) // unknown payment counts in "all" only
    expect(zz1.lifetime.cod).toEqual({ delivered: 3, rto: 1 })
    expect(rows[2].cells['7d'].all).toEqual({ delivered: 4, rto: 2 }) // ZZ1 today + ZZ2 six days ago
  })

  it('is empty for a store with no closed shipments', () => {
    expect(m.deliveryTable('selnova')).toEqual([])
  })
})
