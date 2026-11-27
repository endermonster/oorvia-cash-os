import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMetrics } from '@/lib/metrics'
import { MOCK } from '@/lib/mock'
import { CashCard } from './CashCard'
import { laterParts } from './Home'

const live = { ...MOCK.cash!, bank: null, settlements: null, vfulfillWallet: 190545.17, vfulfillAsOf: '2026-11-19', codDue: 0, codDueOrders: 0 }

describe('CashCard', () => {
  it('with only vFulfill wired: says what is missing, never shows ₹0 for a part not connected', () => {
    const html = renderToStaticMarkup(<CashCard c={createMetrics({ ...MOCK, cash: live }).cash()} />)
    expect(html).toContain('₹1,90,545.17')
    expect(html).toContain('Without bank and gateway settlements.')
    expect(html).toContain('Not entered')
    expect(html).toContain('Not read')
    expect(html).toContain('Every delivered COD order is remitted')
    expect(html).toContain('19 Nov 2026')
    expect(html).not.toContain('Covers')
  })

  it('with a bank balance: adds it and shows the days of spend covered', () => {
    const html = renderToStaticMarkup(<CashCard c={createMetrics({ ...MOCK, cash: { ...live, bank: { amount: 58050, enteredAt: '2026-11-18' }, codDue: 2798, codDueOrders: 2 } }).cash()} />)
    expect(html).toContain('Entered 18 Nov 2026')
    expect(html).toContain('Without gateway settlements.')
    expect(html).toMatch(/Covers \d+ days of ad spend/)
    expect(html).toContain('2 delivered COD orders not remitted yet')
  })

  it('gateway settlements are labelled an estimate, with the total per gateway', () => {
    const settlements = [
      { gateway: 'PayU', storeId: 'kaiven' as const, amount: 1463.62, orders: 1 },
      { gateway: 'Razorpay', storeId: 'kaiven' as const, amount: 1000, orders: 1 },
      { gateway: 'Razorpay', storeId: 'selnova' as const, amount: 500, orders: 2 },
    ]
    const html = renderToStaticMarkup(<CashCard c={createMetrics({ ...MOCK, cash: { ...live, settlements } }).cash()} />)
    expect(html).toContain('Estimate: 4 prepaid orders from Shopify not settled yet')
    expect(html).toContain('Razorpay ₹1,500')
    expect(html).toContain('Without bank.')
  })

  it('nothing pending: ₹0, and says why', () => {
    const html = renderToStaticMarkup(<CashCard c={createMetrics({ ...MOCK, cash: { ...live, settlements: [] } }).cash()} />)
    expect(html).toContain('every prepaid order should have settled by now')
  })

  it("one store: only its own COD due and settlements, and says bank and wallet sit in All VXP", () => {
    const html = renderToStaticMarkup(<CashCard c={createMetrics(MOCK).cash()} store={{ id: 'kaiven', name: 'Kaiven' }} />)
    expect(html).toContain('Cash · Kaiven')
    expect(html).toContain('₹26,360') // 10,400 COD + 9,840 + 6,120 settlements
    expect(html).toContain('7 delivered COD orders not remitted yet')
    expect(html).toContain('Estimate: 11 prepaid orders')
    expect(html).toContain('count in All VXP only')
    expect(html).not.toContain('Covers')
    expect(html).not.toContain('>Bank<')
  })

  it('no source at all', () => {
    expect(renderToStaticMarkup(<CashCard c={null} />)).toContain('No cash source yet')
  })
})

describe('laterParts', () => {
  it('names only what is still to come', () => {
    expect(laterParts(true, true, true)).toBe('Cash, GST and partner share')
    expect(laterParts(false, true, true)).toBe('GST and partner share')
    expect(laterParts(false, false, true)).toBe('Partner share')
  })
})
