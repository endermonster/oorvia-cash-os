import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { breakeven, breaksEven, fromCpa, noBreakevenText, roasZone } from '@/lib/calculator'
import { createMetrics, type StoreStats } from '@/lib/metrics'
import { MOCK, ORDERS } from '@/lib/mock'
import { missingCosts, verdict } from './Home'
import { PaceChart } from './PaceChart'

describe('PaceChart', () => {
  it('renders an empty state, not a crash, when there are no points (a quiet store today)', () => {
    const html = renderToStaticMarkup(<PaceChart points={[]} title="Pace · Today" prevLabel="yesterday by this hour" unit="hour" />)
    expect(html).toContain('No orders or ad spend yet today')
    expect(html).not.toContain('<svg')
  })
})

describe('a product that loses money before ads', () => {
  it('Codex example (₹1,499, ₹300 cost, 20% delivered): no ROAS breaks even, every ROAS is below', () => {
    const b = breakeven({ price: 1499, cogs: 300, packedWeightGrams: 500, deliveryRate: 0.2, codShare: 0.7 })
    expect(b.breakevenCpa).toBeLessThan(0)
    expect(breaksEven(b)).toBe(false)
    expect([b.breakevenRoas, b.targetRoas]).toEqual([Infinity, Infinity])
    for (const roas of [0.5, 3, 50]) expect(roasZone(roas, b)).toBe('below')
    expect(noBreakevenText(b)).toMatch(/^No ROAS breaks even: loses ₹[\d,]+ per order before ads$/)
  })

  it('a breakeven CPA of exactly 0 cannot break even either', () => {
    const b = fromCpa(1000, 0)
    expect(breaksEven(b)).toBe(false)
    expect(noBreakevenText(b)).toBe('No ROAS breaks even: loses ₹0 per order before ads')
  })

  it('a profitable product is unchanged', () => {
    const b = fromCpa(1000, 400)
    expect(breaksEven(b)).toBe(true)
    expect(b.breakevenRoas).toBe(2.5)
  })
})

describe('the Month chart compares the same days as the headline', () => {
  it('on 31 Dec the comparison line stops at 30 Nov and never counts 1 Dec', () => {
    const dec1 = { date: '2026-12-01', storeId: 'kaiven' as const, sku: 'KV-DHS', payment: 'cod' as const, orders: 1, units: 1, revenue: 99_999, cogs: 300, slabs500: 1, slabsKg: 1 }
    ORDERS.push(dec1)
    try {
      const mm = createMetrics({ ...MOCK, today: '2026-12-31' })
      const p = mm.resolvePeriod('month')
      expect([p.prevFrom, p.prevTo]).toEqual(['2026-11-01', '2026-11-30'])
      const last = mm.series(['kaiven'], p).at(-1)!
      expect(last.prevCumRevenue).toBe(mm.storeStats('kaiven', p).prev.revenue)
      expect(last.prevCumRevenue! < 99_999).toBe(true)
    } finally {
      ORDERS.splice(ORDERS.indexOf(dec1), 1)
    }
  })
})

describe('Home: missing costs', () => {
  const m = createMetrics(MOCK)
  const stores = m.portfolio(m.resolvePeriod('7d')).stores
  const withMissing = (id: string, n: number): StoreStats[] => stores.map((s) => (s.store.id === id ? { ...s, ordersMissingCogs: n } : s))
  const notConnected = () => false

  it('says nothing when every order has a cost', () => {
    expect(missingCosts(stores)).toBeNull()
  })

  it('warns, per store, that profit is overstated', () => {
    const s = withMissing('oorvia', 12)
    expect(missingCosts(s)).toBe('Profit is overstated: Oorvia 12 orders with a line that has no cost on record.')
  })

  it('never calls a store with uncosted orders "paying for itself"', () => {
    const profitable = stores.map((s) => ({ ...s, spend: 100, contribution: 500, ordersMissingCogs: s.store.id === 'oorvia' ? 3 : 0 }))
    const v = verdict(profitable, notConnected)
    expect(v).toMatch(/^Oorvia looks profitable, but costs are missing\./)
    expect(v).not.toMatch(/Oorvia (is|and).*paying/)
    expect(v).toMatch(/paying for themselves\.$/) // the other two still are
  })
})
