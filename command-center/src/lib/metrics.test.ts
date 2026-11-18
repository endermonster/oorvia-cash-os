import { describe, expect, it } from 'vitest'
import { addDays, CAMPAIGN_DAYS, CAMPAIGN_HOURS, CAMPAIGNS, COGS_HISTORY, cogsOn, ORDERS, PRODUCTS, productOf, RESOLVED, STORES, TODAY } from './mock'
import {
  campaigns, deliveryRate, MIN_SAMPLE, profitBeforeAds, resolvePeriod, series, skuEconomics, storeStats, type RateWindow,
} from './metrics'
import type { ResolvedDay, StoreId } from './types'

const from: Record<RateWindow, string> = { '7d': addDays(TODAY, -6), '30d': addDays(TODAY, -29), lifetime: '' }
const own = (storeId: StoreId, sku: string, pay: 'cod' | 'prepaid', w: RateWindow) => {
  const rs = RESOLVED.filter((r) => r.storeId === storeId && r.sku === sku && r.payment === pay && r.closedOn >= from[w])
  const delivered = rs.reduce((s, r) => s + r.delivered, 0)
  return { delivered, n: delivered + rs.reduce((s, r) => s + r.rto, 0) }
}

describe('delivery-rate windows (by shipment close date)', () => {
  it('the 30-day rate counts only shipments closed in the last 30 days', () => {
    const { delivered, n } = own('oorvia', 'OMS-1M', 'cod', '30d')
    expect(n).toBeGreaterThanOrEqual(MIN_SAMPLE)
    expect(n).toBeLessThan(own('oorvia', 'OMS-1M', 'cod', 'lifetime').n)
    expect(deliveryRate('oorvia', 'OMS-1M', 'cod', '30d')).toEqual({ value: delivered / n, basis: 'sku', n })
  })

  it('lifetime counts every closed shipment', () => {
    const { delivered, n } = own('oorvia', 'OMS-1M', 'cod', 'lifetime')
    expect(deliveryRate('oorvia', 'OMS-1M', 'cod', 'lifetime')).toEqual({ value: delivered / n, basis: 'sku', n })
  })

  it('falls back within each window on its own sample size', () => {
    for (const p of PRODUCTS) {
      for (const pay of ['cod', 'prepaid'] as const) {
        for (const w of ['7d', '30d', 'lifetime'] as const) {
          const ownEnough = own(p.storeId, p.sku, pay, w).n >= MIN_SAMPLE
          expect(deliveryRate(p.storeId, p.sku, pay, w).basis === 'sku', `${p.sku} ${pay} ${w}`).toBe(ownEnough)
        }
      }
    }
  })
})

describe('a product is (store, SKU)', () => {
  it("another store's history under the same SKU never enters this product's rate", () => {
    const before = deliveryRate('oorvia', 'OMS-1M', 'cod', 'lifetime')
    const clash: ResolvedDay = { closedOn: TODAY, storeId: 'selnova', sku: 'OMS-1M', payment: 'cod', delivered: 0, rto: 500 }
    RESOLVED.push(clash)
    try {
      expect(deliveryRate('oorvia', 'OMS-1M', 'cod', 'lifetime')).toEqual(before)
    } finally {
      RESOLVED.splice(RESOLVED.indexOf(clash), 1)
    }
  })

  it('looks products up by store and SKU together', () => {
    expect(productOf('kaiven', 'KV-DHS').storeId).toBe('kaiven')
    expect(() => productOf('selnova', 'KV-DHS')).toThrow()
  })
})

describe('order costs', () => {
  const base = { storeId: 'kaiven' as const, sku: 'KV-DHS', payment: 'cod' as const, orders: 1, revenue: 2998 }

  it("a 2-unit order pays both units' COGS and the extra shipping slab", () => {
    const d = skuEconomics('kaiven', 'KV-DHS').rates.cod.value
    const oneUnitCosts = profitBeforeAds({ ...base, units: 2, cogs: 300, slabs500: 1, slabsKg: 1 })
    const fullCosts = profitBeforeAds({ ...base, units: 2, cogs: 600, slabs500: 2, slabsKg: 1 })
    // Extra COGS: lost on delivery, 10% lost on RTO. Extra slab: ₹58 out, ₹3 packing, ₹58 back on RTO.
    const expected = 300 * (d + 0.1 * (1 - d)) + 58 + 3 + 58 * (1 - d)
    expect(oneUnitCosts - fullCosts).toBeCloseTo(expected, 6)
  })

  it("changing today's product cost leaves past profit alone", () => {
    const p = productOf('kaiven', 'KV-DHS')
    const period = resolvePeriod('30d')
    const before = storeStats('kaiven', period).contribution
    p.cogs += 100
    try {
      expect(storeStats('kaiven', period).contribution).toBe(before)
    } finally {
      p.cogs -= 100
    }
  })

  it('a cost change applies from its date onward only', () => {
    const change = { storeId: 'kaiven' as const, sku: 'KV-DHS', cogs: 400, from: '2026-11-15' }
    COGS_HISTORY.push(change)
    try {
      expect(cogsOn('kaiven', 'KV-DHS', '2026-11-14')).toBe(300)
      expect(cogsOn('kaiven', 'KV-DHS', '2026-11-15')).toBe(400)
    } finally {
      COGS_HISTORY.splice(COGS_HISTORY.indexOf(change), 1)
    }
  })
})

describe('campaigns', () => {
  const p = resolvePeriod('7d')

  it("use each campaign's own spend and its attributed Shopify orders", () => {
    for (const c of campaigns('kaiven', p)) {
      const rows = CAMPAIGN_DAYS.filter((r) => r.campaignId === c.id && r.date >= p.from && r.date <= p.to)
      expect(c.spend).toBe(rows.reduce((s, r) => s + r.spend, 0))
      expect(c.orders).toBe(rows.reduce((s, r) => s + r.attributedOrders, 0))
      expect(c.cpa).toBe(c.orders > 0 ? c.spend / c.orders : null)
    }
  })

  it('flag spend with zero orders as a loss once it passes one breakeven CPA', () => {
    const beCpa = skuEconomics('kaiven', 'KV-DHS').breakevenCpa
    const test = { id: 'kv-test', storeId: 'kaiven' as const, sku: 'KV-DHS', name: 'Zero-sale test' }
    const day = (spend: number) => ({
      date: addDays(TODAY, -1), storeId: 'kaiven' as const, campaignId: test.id, sku: 'KV-DHS',
      spend, impressions: 1000, clicks: 10, metaPurchases: 0, attributedOrders: 0,
    })
    CAMPAIGNS.push(test)
    const burned = day(10000)
    CAMPAIGN_DAYS.push(burned)
    try {
      const c = campaigns('kaiven', p).find((x) => x.id === test.id)!
      expect(c.cpa).toBeNull()
      expect(c.noSalesLoss).toBe(true)
      burned.spend = Math.floor(beCpa) - 1 // still under one order's worth: too early to call
      expect(campaigns('kaiven', p).find((x) => x.id === test.id)!.noSalesLoss).toBe(false)
    } finally {
      CAMPAIGN_DAYS.splice(CAMPAIGN_DAYS.indexOf(burned), 1)
      CAMPAIGNS.splice(CAMPAIGNS.indexOf(test), 1)
    }
  })

  it('leave unattributed orders (organic, lost IDs) outside every campaign', () => {
    const attributed = campaigns('kaiven', p).reduce((s, c) => s + c.orders, 0)
    expect(attributed).toBeLessThan(storeStats('kaiven', p).orders)
  })
})

describe("today's pace chart", () => {
  it('carries every rupee of spend the headline counts', () => {
    const today = resolvePeriod('today')
    for (const s of STORES) {
      const pts = series([s.id], today)
      const daySpend = CAMPAIGN_DAYS.filter((r) => r.storeId === s.id && r.date === TODAY).reduce((t, r) => t + r.spend, 0)
      expect(CAMPAIGN_HOURS.filter((r) => r.storeId === s.id).reduce((t, r) => t + r.spend, 0)).toBe(daySpend)
      expect(pts.length ? pts[pts.length - 1].cumSpend : 0).toBe(storeStats(s.id, today).spend)
    }
  })

  it('matches the headline revenue and orders', () => {
    const today = resolvePeriod('today')
    const pts = series(STORES.map((s) => s.id), today)
    const rev = ORDERS.filter((r) => r.date === TODAY).reduce((t, r) => t + r.revenue, 0)
    expect(pts[pts.length - 1].cumRevenue).toBeCloseTo(rev, 6)
  })
})
