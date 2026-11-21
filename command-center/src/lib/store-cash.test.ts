import { describe, expect, it } from 'vitest'
import { CASH } from './mock'
import { storeCash } from './store-cash'

describe('storeCash', () => {
  it("a store's own COD due and settlements; bank and wallet are not in its total", () => {
    const s = storeCash(CASH, 'kaiven')
    expect(s.codDue).toBe(10400)
    expect(s.codDueOrders).toBe(7)
    expect(s.settlements?.map((x) => x.gateway)).toEqual(['Razorpay', 'PayU'])
    expect(s.settlementsTotal).toBe(9840 + 6120)
    expect(s.total).toBe(10400 + 9840 + 6120)
    expect(s.shared).toEqual({ bank: CASH.bank, vfulfillWallet: CASH.vfulfillWallet })
  })

  it('the stores add up to the VXP COD due and settlements', () => {
    const all = (['oorvia', 'kaiven', 'selnova'] as const).map((id) => storeCash(CASH, id))
    expect(all.reduce((s, x) => s + x.codDue, 0)).toBe(CASH.codDue)
    expect(all.reduce((s, x) => s + x.settlementsTotal, 0)).toBe(CASH.settlements!.reduce((s, x) => s + x.amount, 0))
  })

  it('a store with nothing due: zeros, not missing; settlements not read stay null', () => {
    const bare = { ...CASH, codDueByStore: [], settlements: null }
    expect(storeCash(bare, 'selnova')).toMatchObject({ codDue: 0, codDueOrders: 0, settlements: null, settlementsTotal: 0, total: 0 })
  })
})
