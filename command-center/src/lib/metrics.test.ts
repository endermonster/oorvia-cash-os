import { describe, expect, it } from 'vitest'
import {
  addDays, CAMPAIGN_DAYS, CAMPAIGN_HOURS, CAMPAIGNS, COGS_HISTORY, cogsOn, MOCK, NOW_HOUR, NOW_MINUTE, ORDER_HOURS_YESTERDAY, ORDERS, PRODUCTS,
  RESOLVED, STORES, TODAY,
} from './mock'
import { createMetrics, MIN_SAMPLE, type RateWindow } from './metrics'
import type { ResolvedDay, StoreId } from './types'

const m = createMetrics(MOCK)
const { campaigns, deliveryRate, profitBeforeAds, productOf, resolvePeriod, series, skuEconomics, storeStats } = m

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
    const d = skuEconomics('kaiven', 'KV-DHS')!.rates.cod.value
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
    p.cogs = p.cogs! + 100
    try {
      expect(storeStats('kaiven', period).contribution).toBe(before)
    } finally {
      p.cogs = p.cogs! - 100
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
    const beCpa = skuEconomics('kaiven', 'KV-DHS')!.breakevenCpa
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

describe("the Today comparison is yesterday up to now", () => {
  /** Yesterday's rows before the current hour in full, plus the current hour pro rata. */
  const expectedPrev = (hour: number, minute: number, storeId: string) => {
    const f = (h: number) => (h < hour ? 1 : h === hour ? minute / 60 : 0)
    const orders = ORDER_HOURS_YESTERDAY.filter((r) => r.storeId === storeId)
    const spend = MOCK.campaignHoursYesterday.filter((r) => r.storeId === storeId)
    return {
      revenue: orders.reduce((t, r) => t + r.revenue * f(r.hour), 0),
      orders: orders.reduce((t, r) => t + r.orders * f(r.hour), 0),
      spend: spend.reduce((t, r) => t + r.spend * f(r.hour), 0),
    }
  }

  it('uses the real mock clock: hours before nowHour whole, the nowHour row by minutes elapsed', () => {
    expect(MOCK.nowHour).toBe(NOW_HOUR)
    expect(MOCK.nowMinute).toBe(NOW_MINUTE)
    for (const s of STORES) {
      const stats = storeStats(s.id, resolvePeriod('today'))
      const e = expectedPrev(NOW_HOUR, NOW_MINUTE, s.id)
      expect(stats.prev.revenue).toBeCloseTo(e.revenue, 6)
      expect(stats.prev.orders).toBeCloseTo(e.orders, 6)
      expect(stats.prev.spend).toBeCloseTo(e.spend, 6)
    }
  })

  for (const [hour, minute] of [[0, 30], [23, 59], [9, 0], [14, 45]] as const) {
    it(`holds at ${hour}:${String(minute).padStart(2, '0')}`, () => {
      const at = createMetrics({ ...MOCK, nowHour: hour, nowMinute: minute })
      for (const s of STORES) {
        const stats = at.storeStats(s.id, at.resolvePeriod('today'))
        const e = expectedPrev(hour, minute, s.id)
        expect(stats.prev.revenue).toBeCloseTo(e.revenue, 6)
        expect(stats.prev.spend).toBeCloseTo(e.spend, 6)
      }
    })
  }

  it('at the top of hour 0 nothing of yesterday has happened yet', () => {
    const at = createMetrics({ ...MOCK, nowHour: 0, nowMinute: 0 })
    for (const s of STORES) expect(at.storeStats(s.id, at.resolvePeriod('today')).prev.revenue).toBe(0)
  })

  it('yesterday hours carry all 24 hours and add up to the day', () => {
    for (const s of STORES) {
      const day = ORDERS.filter((r) => r.storeId === s.id && r.date === addDays(TODAY, -1)).reduce((t, r) => t + r.revenue, 0)
      const hours = ORDER_HOURS_YESTERDAY.filter((r) => r.storeId === s.id)
      expect(hours.reduce((t, r) => t + r.revenue, 0)).toBeCloseTo(day, 6)
      expect(Math.max(0, ...hours.map((r) => r.hour))).toBeLessThanOrEqual(23)
    }
  })

  it("the pace chart's dashed line is yesterday's cumulative revenue, the current hour pro rata", () => {
    const ids = STORES.map((s) => s.id)
    const pts = series(ids, resolvePeriod('today'))
    for (const p of pts) {
      const h = Number(p.key)
      const expected = ORDER_HOURS_YESTERDAY.filter((r) => r.hour <= h).reduce((t, r) => t + r.revenue * (r.hour < NOW_HOUR ? 1 : r.hour === NOW_HOUR ? NOW_MINUTE / 60 : 0), 0)
      expect(p.prevCumRevenue).toBeCloseTo(expected, 6)
    }
    const last = pts[pts.length - 1]
    expect(last.key).toBe(String(NOW_HOUR))
    expect(last.prevCumRevenue).toBeCloseTo(ids.reduce((t, id) => t + storeStats(id, resolvePeriod('today')).prev.revenue, 0), 6)
  })
})

describe('the Month comparison stays inside last month', () => {
  const at = (today: string) => createMetrics({ ...MOCK, today }).resolvePeriod('month')

  it('31 Mar compares with 1-28 Feb, never March', () => {
    expect(at('2026-03-31')).toMatchObject({ from: '2026-03-01', prevFrom: '2026-02-01', prevTo: '2026-02-28' })
  })
  it('29 Feb in a leap year compares with 1-29 Jan', () => {
    expect(at('2028-02-29')).toMatchObject({ prevFrom: '2028-01-01', prevTo: '2028-01-29' })
  })
  it('31 Mar in a leap year compares with 1-29 Feb', () => {
    expect(at('2028-03-31')).toMatchObject({ prevFrom: '2028-02-01', prevTo: '2028-02-29' })
  })
  it('30 May compares with 1-30 Apr', () => {
    expect(at('2026-05-30')).toMatchObject({ prevFrom: '2026-04-01', prevTo: '2026-04-30' })
  })
  it('31 May compares with 1-30 Apr (April has no 31st)', () => {
    expect(at('2026-05-31')).toMatchObject({ prevFrom: '2026-04-01', prevTo: '2026-04-30' })
  })
  it('a mid-month date compares with the same days', () => {
    expect(at('2026-11-18')).toMatchObject({ prevFrom: '2026-10-01', prevTo: '2026-10-18' })
  })
  it('January compares with December of the year before', () => {
    expect(at('2026-01-15')).toMatchObject({ prevFrom: '2025-12-01', prevTo: '2025-12-15' })
  })
})

describe('products and orders that are not set up', () => {
  const week = resolvePeriod('7d')
  const ghost = {
    date: addDays(TODAY, -1), storeId: 'kaiven' as const, sku: 'GHOST-1', payment: 'cod' as const,
    orders: 2, units: 2, revenue: 2998, cogs: 600, slabs500: 2, slabsKg: 2,
  }

  it('an order for an unknown SKU does not throw, is counted, and is listed', () => {
    const before = storeStats('kaiven', week)
    expect(before.unknownSkus).toEqual([])
    ORDERS.push(ghost)
    try {
      const after = storeStats('kaiven', week)
      expect(after.orders).toBe(before.orders + 2)
      expect(after.revenue).toBeCloseTo(before.revenue + 2998, 6)
      expect(after.unknownSkus).toEqual(['GHOST-1'])
      expect(Number.isFinite(after.contribution)).toBe(true)
      expect(() => m.portfolio(week)).not.toThrow()
      expect(() => m.calls(week)).not.toThrow()
    } finally {
      ORDERS.splice(ORDERS.indexOf(ghost), 1)
    }
  })

  it('profit before ads for an unknown SKU matches the same order for a known SKU', () => {
    const known = profitBeforeAds({ ...ghost, sku: 'KV-DHS' })
    expect(profitBeforeAds(ghost)).toBeCloseTo(known, 6)
  })

  it('a product with no cost raises no error in any metric, and is skipped for breakeven', () => {
    const noCost = createMetrics({
      ...MOCK,
      products: MOCK.products.map((p) => (p.storeId === 'kaiven' ? { ...p, cogs: null } : p)),
    })
    for (const id of ['today', '7d', '30d', 'month'] as const) {
      const per = noCost.resolvePeriod(id)
      expect(() => noCost.portfolio(per)).not.toThrow()
      expect(() => noCost.calls(per)).not.toThrow()
      expect(() => noCost.series(['kaiven'], per)).not.toThrow()
      expect(() => noCost.campaigns('kaiven', per)).not.toThrow()
    }
    expect(noCost.skuEconomics('kaiven', 'KV-DHS')).toBeNull()
    expect(noCost.storeEconomics('kaiven')).toBeNull()
    expect(noCost.storeEconomics('oorvia')).not.toBeNull()
    // Rates do not depend on cost, so a cost-less product still counts for the borrowed-rates check.
    expect(noCost.borrowedRates().map((s) => s.id)).toEqual(m.borrowedRates().map((s) => s.id))
    const s = noCost.storeStats('kaiven', week)
    expect(s.economics).toBeNull()
    expect(s.zone).toBeNull()
    expect(s.orders).toBeGreaterThan(0)
    expect(Number.isFinite(s.contribution)).toBe(true)
    expect(noCost.products.filter((p) => p.cogs === null).map((p) => p.sku)).toEqual(['KV-DHS'])
    for (const c of noCost.campaigns('kaiven', week)) {
      expect(c.vsBreakeven).toBeNull()
      expect(c.noSalesLoss).toBe(false)
    }
  })

  it('a store breakeven weights only the costed products', () => {
    const two = {
      ...MOCK,
      products: [...MOCK.products, { ...MOCK.products.find((p) => p.storeId === 'kaiven')!, sku: 'KV-NOCOST', cogs: null }],
    }
    expect(createMetrics(two).storeEconomics('kaiven')).toEqual(m.storeEconomics('kaiven'))
  })
})

describe('orders missing a cost', () => {
  it('sum into the period stats, and are 0 in the mock', () => {
    const week = resolvePeriod('7d')
    expect(storeStats('kaiven', week).ordersMissingCogs).toBe(0)
    const row = { date: addDays(TODAY, -1), storeId: 'kaiven' as const, sku: 'KV-DHS', payment: 'cod' as const, orders: 3, units: 3, revenue: 4497, cogs: 600, slabs500: 3, slabsKg: 3, ordersMissingCogs: 2 }
    ORDERS.push(row)
    try {
      expect(storeStats('kaiven', week).ordersMissingCogs).toBe(2)
    } finally {
      ORDERS.splice(ORDERS.indexOf(row), 1)
    }
  })
})

describe('sources not wired yet', () => {
  const bare = createMetrics({ ...MOCK, cash: null, gst: null, fixedCostsMonthly: null })

  it('return null instead of figures', () => {
    expect(bare.cash()).toBeNull()
    expect(bare.gst()).toBeNull()
    expect(bare.ownerShare()).toBeNull()
  })

  it('skip the cash-low call', () => {
    const low = createMetrics({ ...MOCK, cash: { ...MOCK.cash!, bank: { amount: 0, enteredAt: '' }, settlements: [], vfulfillWallet: 0, codDue: 1 } })
    expect(low.calls(resolvePeriod('7d')).some((c) => c.id === 'cash')).toBe(true)
    expect(bare.calls(resolvePeriod('7d')).some((c) => c.id === 'cash')).toBe(false)
  })
})

describe('cash with parts not connected', () => {
  const partial = createMetrics({ ...MOCK, cash: { ...MOCK.cash!, bank: null, settlements: null, vfulfillWallet: 1000, codDue: 200 } })

  it('totals only what is connected and names what is missing', () => {
    const c = partial.cash()!
    expect(c.total).toBe(1200)
    expect(c.missing).toEqual(['bank', 'gateway settlements'])
    expect(c.included).toEqual(['vFulfill wallet', 'COD due'])
  })

  it('never raises the cash-low alarm without a bank balance (the total is only part of the cash)', () => {
    expect(partial.cash()!.coversDays).toBeLessThan(10)
    expect(partial.calls(resolvePeriod('7d')).some((c) => c.id === 'cash')).toBe(false)
  })

  it('with a bank balance but no gateways, the alarm counts and says what it covered', () => {
    const noGw = createMetrics({ ...MOCK, cash: { ...MOCK.cash!, bank: { amount: 100, enteredAt: '2026-11-19' }, settlements: null, vfulfillWallet: 0, codDue: 0 } })
    const call = noGw.calls(resolvePeriod('7d')).find((c) => c.id === 'cash')!
    expect(call.detail).toBe('₹100 across bank, vFulfill wallet, COD due')
  })
})

describe('relevant products', () => {
  const week = resolvePeriod('7d')
  const dormant = { ...MOCK.products.find((p) => p.storeId === 'oorvia')!, sku: 'OLD-1', handle: 'old-1', name: 'Old', stage: 'testing' as const }
  const withDormant = createMetrics({ ...MOCK, products: [...MOCK.products, dormant] })

  it('keeps products with orders or spend in the period, and any live product', () => {
    expect(m.relevantProducts('kaiven', week).map((p) => p.sku)).toEqual(['KV-DHS'])
    expect(withDormant.relevantProducts('oorvia', week).map((p) => p.sku)).toEqual(['OMS-1M']) // live; the dormant one is out
  })

  it('includes a dormant product once it has orders or spend in the period', () => {
    const row = { date: addDays(TODAY, -1), storeId: 'oorvia' as const, sku: 'OLD-1', payment: 'cod' as const, orders: 1, units: 1, revenue: 2499, cogs: 581, slabs500: 1, slabsKg: 1 }
    const spend = { date: addDays(TODAY, -1), storeId: 'oorvia' as const, campaignId: 'x', sku: 'OLD-1', spend: 10, impressions: 1, clicks: 1, metaPurchases: 0, attributedOrders: 0 }
    const a = createMetrics({ ...MOCK, products: [...MOCK.products, dormant], orders: [...ORDERS, row] })
    const b = createMetrics({ ...MOCK, products: [...MOCK.products, dormant], campaignDays: [...CAMPAIGN_DAYS, spend] })
    expect(a.relevantProducts('oorvia', week).map((p) => p.sku)).toContain('OLD-1')
    expect(b.relevantProducts('oorvia', week).map((p) => p.sku)).toContain('OLD-1')
  })

  it('a dormant catalogue item does not dilute the store breakeven or the borrowed-rates check', () => {
    expect(withDormant.storeEconomics('oorvia')).toEqual(m.storeEconomics('oorvia'))
    expect(withDormant.borrowedRates(undefined, week).map((s) => s.id)).toEqual(m.borrowedRates(undefined, week).map((s) => s.id))
  })

  it('with no orders in 30 days, weights the relevant costed products equally, not the whole catalogue', () => {
    const quiet = createMetrics({
      ...MOCK, orders: MOCK.orders.filter((r) => r.storeId !== 'oorvia'),
      products: [...MOCK.products, dormant, { ...dormant, sku: 'OLD-2', handle: 'old-2' }],
    })
    const onlyLive = createMetrics({ ...MOCK, orders: MOCK.orders.filter((r) => r.storeId !== 'oorvia') })
    expect(quiet.storeEconomics('oorvia')).toEqual(onlyLive.storeEconomics('oorvia'))
  })
})

describe('breakeven names and borrowed rates', () => {
  const week = resolvePeriod('7d')

  it('storeEconomics names the products it weighted, never an empty list', () => {
    for (const s of STORES) {
      const e = m.storeEconomics(s.id)!
      expect(e.weightedNames.length).toBeGreaterThan(0)
    }
    expect(m.storeEconomics('kaiven')!.weightedNames).toEqual(['Medicube Deoxyribose Scalp Serum'])
  })

  it('with no orders, names only the relevant costed products', () => {
    const dormant = { ...MOCK.products.find((p) => p.storeId === 'oorvia')!, sku: 'OLD-1', handle: 'old-1', name: 'Old', stage: 'testing' as const }
    const quiet = createMetrics({ ...MOCK, orders: MOCK.orders.filter((r) => r.storeId !== 'oorvia'), products: [...MOCK.products, dormant] })
    expect(quiet.storeEconomics('oorvia')!.weightedNames).toEqual(['Microinfusion System'])
  })

  it('borrowedRates counts a SKU that has orders but no product', () => {
    const orphaned = createMetrics({ ...MOCK, products: MOCK.products.filter((p) => p.storeId !== 'kaiven') })
    expect(orphaned.storeStats('kaiven', week).unknownSkus).toEqual(['KV-DHS'])
    const basis = (['cod', 'prepaid'] as const).map((pay) => orphaned.deliveryRate('kaiven', 'KV-DHS', pay).basis)
    expect(basis.some((x) => x === 'vxp' || x === 'sheet')).toBe(true) // Kaiven is too young to have its own rates
    expect(orphaned.borrowedRates(['kaiven'], week).map((x) => x.id)).toEqual(['kaiven'])
  })
})

describe('VXP breakeven (decided 2026-11-21: store breakevens weighted by revenue, plus fixed costs)', () => {
  const week = resolvePeriod('7d')
  const noFixed = createMetrics({ ...MOCK, fixedCostsRunRate: null })

  it('is Σ revenue ÷ (Σ profit before ads at each store’s breakeven − fixed costs)', () => {
    const pf = m.portfolio(week)
    const costed = pf.stores.filter((s) => s.economics && s.revenue > 0)
    const revenue = costed.reduce((t, s) => t + s.revenue, 0)
    const pool = costed.reduce((t, s) => t + (s.revenue / s.economics!.avgPricePaid) * s.economics!.breakevenCpa, 0)
    const b = pf.total.breakeven!
    expect(b.fixedCosts).toBeGreaterThan(0)
    expect(b.breakevenRoas).toBeCloseTo(revenue / (pool - b.fixedCosts), 6)
  })

  it('without fixed costs, one store’s VXP breakeven is that store’s breakeven', () => {
    const one = noFixed.portfolio(week, ['kaiven'])
    expect(one.total.breakeven!.fixedOnRecord).toBe(false)
    expect(one.total.breakeven!.breakevenRoas).toBeCloseTo(one.stores[0].economics!.breakevenRoas, 6)
  })

  it('fixed costs raise it, and prorate by the days in the period', () => {
    const b = m.portfolio(week).total.breakeven!
    expect(b.breakevenRoas).toBeGreaterThan(noFixed.portfolio(week).total.breakeven!.breakevenRoas)
    const month = m.portfolio(resolvePeriod('30d')).total.breakeven!
    // 30 days vs 7, both ending today part-way through: the ratio sits just above 30/7.
    expect(month.fixedCosts / b.fixedCosts).toBeGreaterThan(30 / 7)
    expect(month.fixedCosts / b.fixedCosts).toBeLessThan(30 / 6)
  })

  it('no ROAS breaks even when fixed costs swallow the profit before ads', () => {
    const huge = createMetrics({ ...MOCK, fixedCostsRunRate: 100_000_000 })
    expect(huge.portfolio(week).total.breakeven!.breakevenRoas).toBe(Infinity)
    expect(huge.portfolio(week).total.zone).toBe('below')
  })
})

describe('a store losing money always reaches Needs your call', () => {
  const week = resolvePeriod('7d')

  it('every losing store has a below-breakeven or a loss line', () => {
    const ids = m.calls(week).map((c) => c.id)
    for (const s of m.portfolio(week).stores.filter((x) => x.contribution < 0)) {
      expect(ids.some((id) => id === `${s.store.id}-below` || id === `${s.store.id}-loss`)).toBe(true)
    }
  })

  it('names the loss when the 3-day rule does not fire', () => {
    // Move Selnova's spend from two days ago to today: same week, but the 3-day rule needs spend on all three days.
    const gap = createMetrics({ ...MOCK, campaignDays: CAMPAIGN_DAYS.map((r) => (r.storeId === 'selnova' && r.date === addDays(TODAY, -2) ? { ...r, date: TODAY } : r)) })
    expect(gap.storeStats('selnova', week).contribution).toBeLessThan(0)
    const call = gap.calls(week).find((c) => c.id === 'selnova-loss')!
    expect(call.tone).toBe('bad')
    expect(call.detail).toMatch(/^Profit \(est\.\) −₹[\d,]+ over 7D/)
    expect(gap.calls(week).some((c) => c.id === 'selnova-below')).toBe(false)
  })
})
