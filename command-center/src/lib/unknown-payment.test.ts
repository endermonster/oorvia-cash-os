import { describe, expect, it } from 'vitest'
import { createMetrics } from './metrics'
import { MOCK } from './mock'
import type { OrderDay } from './types'

const base = MOCK.orders.findLast((r) => r.storeId === 'oorvia' && r.orders > 0)!
const row = (payment: OrderDay['payment']): OrderDay => ({ ...base, payment })

describe('orders whose payment type was never recorded', () => {
  const unknown = row('unknown')
  const plain = createMetrics(MOCK)
  const withUnknown = createMetrics({ ...MOCK, orders: [...MOCK.orders, unknown] })

  it('do not move the COD share: it is taken over known payments only', () => {
    expect(withUnknown.codShare('oorvia', base.sku)).toEqual(plain.codShare('oorvia', base.sku))
  })

  it('are counted as orders, but neither as COD nor as prepaid', () => {
    const period = plain.resolvePeriod('30d')
    expect(base.date >= period.from && base.date <= period.to).toBe(true)
    const a = plain.storeStats('oorvia', period)
    const b = withUnknown.storeStats('oorvia', period)
    expect(b.orders - a.orders).toBe(unknown.orders)
    expect(b.codOrders).toBe(a.codOrders)
    expect(b.unknownPayOrders - a.unknownPayOrders).toBe(unknown.orders)
  })

  it('expect profit at the product own COD/prepaid mix, between the two known cases', () => {
    const cod = withUnknown.profitBeforeAds(row('cod'))
    const prepaid = withUnknown.profitBeforeAds(row('prepaid'))
    const share = withUnknown.codShare('oorvia', base.sku).value
    expect(withUnknown.profitBeforeAds(unknown)).toBeCloseTo(share * cod + (1 - share) * prepaid, 6)
  })
})
