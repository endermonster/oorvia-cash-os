import { describe, expect, it } from 'vitest'
import { estimateSettlements, gatewayOf, isBankDay, settlesOn } from './settlements'

const stores = [{ id: 'oorvia', gatewayPct: 0.02 }, { id: 'kaiven', gatewayPct: 0.02 }]
// 2026-11-21 is a Saturday (the 3rd of the month: a bank working day). 2026-11-14 is the 2nd Saturday.
const order = (storeId: string, placedAt: string, gateways: string[], totalPaise = 149_900) => ({ storeId, placedAt, gateways, totalPaise })

describe('bank working days', () => {
  it('skips Sundays and the 2nd and 4th Saturdays only', () => {
    expect(isBankDay('2026-11-22')).toBe(false) // Sunday
    expect(isBankDay('2026-11-14')).toBe(false) // 2nd Saturday
    expect(isBankDay('2026-11-28')).toBe(false) // 4th Saturday
    expect(isBankDay('2026-11-21')).toBe(true) // 3rd Saturday
    expect(isBankDay('2026-11-07')).toBe(true) // 1st Saturday
    expect(isBankDay('2026-11-20')).toBe(true) // Friday
  })

  it('T+2 counts working days only', () => {
    expect(settlesOn('2026-11-18')).toBe('2026-11-20') // Wed → Fri
    expect(settlesOn('2026-11-20')).toBe('2026-11-23') // Fri → Sat (3rd) → Mon
    expect(settlesOn('2026-11-26')).toBe('2026-11-30') // Thu → Fri → (4th Sat, Sun) → Mon
    expect(settlesOn('2026-11-22')).toBe('2026-11-24') // placed on a Sunday
  })
})

describe('gatewayOf', () => {
  it("reads Shopify's gateway names as stored; anything else settles nothing", () => {
    expect(gatewayOf(['01 Cards, UPI, NB, Wallets by Razorpay'])).toBe('Razorpay')
    expect(gatewayOf(['PayU'])).toBe('PayU')
    expect(gatewayOf(['1Cashfree Payments(UPI,Cards,Net Banking,Wallets)'])).toBe('Cashfree')
    expect(gatewayOf(['gift_card', 'Cashfree'])).toBe('Cashfree')
    expect(gatewayOf(['gift_card'])).toBeNull()
    expect(gatewayOf(['Snapmint'])).toBeNull()
    expect(gatewayOf([])).toBeNull()
  })
})

describe('estimateSettlements', () => {
  const today = '2026-11-21'

  it('counts orders not yet due to settle, net of fee + 18% GST, grouped by store and gateway', () => {
    const r = estimateSettlements([
      order('kaiven', '2026-11-19T10:00:00+05:30', ['PayU']), // settles Sat 21 = today: settled
      order('kaiven', '2026-11-20T23:30:00+05:30', ['PayU']), // settles Mon 23
      order('kaiven', '2026-11-21T09:00:00+05:30', ['PayU'], 100_000), // settles Tue 24
      order('oorvia', '2026-11-20T12:00:00+05:30', ['Cashfree']),
    ], stores, today)
    expect(r).toEqual([
      // PayU at the store's 2%: 149,900 − round(149,900 × 0.02 × 1.18) = 146,362; 100,000 − 2,360 = 97,640.
      { gateway: 'PayU', storeId: 'kaiven', paise: 146_362 + 97_640, orders: 2 },
      // Cashfree at 2.5%: 149,900 − round(4,422.05) = 145,478.
      { gateway: 'Cashfree', storeId: 'oorvia', paise: 145_478, orders: 1 },
    ])
  })

  it('dates an order by IST: 20 Nov 19:30 UTC is 21 Nov 01:00 IST, so it settles Tue 24, not Mon 23', () => {
    const r = estimateSettlements([order('kaiven', '2026-11-20T19:30:00Z', ['PayU'])], stores, '2026-11-23') // = 21 Nov 01:00 IST → settles Tue 24
    expect(r).toHaveLength(1)
  })

  it('nothing pending: an empty list, not null', () => {
    expect(estimateSettlements([order('kaiven', '2026-11-10T10:00:00+05:30', ['PayU'])], stores, today)).toEqual([])
  })

  it('leaves out orders no settling gateway captured: gift card only, or no gateway', () => {
    expect(estimateSettlements([
      order('kaiven', '2026-11-21T10:00:00+05:30', ['gift_card']),
      order('kaiven', '2026-11-21T10:00:00+05:30', []),
    ], stores, today)).toEqual([])
  })

  it('leaves out a store it has no fee rate for', () => {
    expect(estimateSettlements([order('selnova', '2026-11-21T10:00:00+05:30', ['Razorpay'])], stores, today)).toEqual([])
  })
})
