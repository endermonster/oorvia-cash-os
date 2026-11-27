import { describe, expect, it } from 'vitest'
import {
  addDays, CAMPAIGN_DAYS, CAMPAIGN_HOURS, CAMPAIGNS, COGS_HISTORY, cogsOn, MOCK, NOW_HOUR, NOW_MINUTE, ORDER_HOURS_YESTERDAY, ORDERS, PRODUCTS,
  RESOLVED, STORES, TODAY,
} from './mock'
import { clampCustom, createMetrics, historyDaysFor, MIN_SAMPLE, type RateWindow } from './metrics'
import type { AdAccountFunds, Campaign, CampaignDay, OrderDay, ResolvedDay, StoreId } from './types'

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
    expect(deliveryRate('oorvia', 'OMS-1M', 'cod', '30d')).toEqual({ value: delivered / n, basis: 'sku', n, window: '30d' })
  })

  it('lifetime counts every closed shipment', () => {
    const { delivered, n } = own('oorvia', 'OMS-1M', 'cod', 'lifetime')
    expect(deliveryRate('oorvia', 'OMS-1M', 'cod', 'lifetime')).toEqual({ value: delivered / n, basis: 'sku', n, window: 'lifetime' })
  })

  it('uses the SKU only when it has enough shipments in the requested window', () => {
    for (const p of PRODUCTS) {
      for (const pay of ['cod', 'prepaid'] as const) {
        for (const w of ['7d', '30d', 'lifetime'] as const) {
          const ownEnough = own(p.storeId, p.sku, pay, w).n >= MIN_SAMPLE
          expect(deliveryRate(p.storeId, p.sku, pay, w).basis === 'sku', `${p.sku} ${pay} ${w}`).toBe(ownEnough)
        }
      }
    }
  })

  const recent: ResolvedDay = { closedOn: TODAY, storeId: 'oorvia', sku: 'OMS-1M', payment: 'cod', delivered: 16, rto: 4 }
  const older: ResolvedDay = { ...recent, closedOn: addDays(TODAY, -30), delivered: 444, rto: 131 }

  it('uses the recent store rate when recent shipments across SKUs reach the minimum', () => {
    const at = createMetrics({ ...MOCK, resolved: [recent, older, { ...recent, sku: 'OLD-1', delivered: 6 }] })
    expect(at.deliveryRate('oorvia', 'OMS-1M', 'cod')).toEqual({ value: 22 / 30, basis: 'store', n: 30, window: '30d' })
  })

  it('uses the store lifetime rate even when VXP has enough recent shipments', () => {
    const at = createMetrics({ ...MOCK, resolved: [recent, older, { ...recent, storeId: 'kaiven', delivered: 50 }] })
    expect(at.deliveryRate('oorvia', 'OMS-1M', 'cod')).toEqual({ value: 460 / 595, basis: 'store', n: 595, window: 'lifetime' })
  })

  it('uses VXP lifetime for a new store even when VXP has enough recent shipments', () => {
    const at = createMetrics({ ...MOCK, resolved: [recent, older, { ...recent, storeId: 'kaiven', delivered: 50 }] })
    expect(at.deliveryRate('selnova', 'SN-PDRN', 'cod')).toEqual({ value: 510 / 649, basis: 'vxp', n: 649, window: 'lifetime' })
  })

  it('uses the sheet when lifetime history is too small', () => {
    for (const resolved of [[], [recent]]) {
      const at = createMetrics({ ...MOCK, resolved })
      expect(at.deliveryRate('oorvia', 'OMS-1M', 'cod')).toEqual({ value: 0.9, basis: 'sheet', n: 0, window: null })
    }
  })
})

describe('COD share windows (by order date)', () => {
  const recent: OrderDay = {
    date: TODAY, storeId: 'oorvia', sku: 'OMS-1M', payment: 'cod', orders: 18,
    units: 18, revenue: 44982, cogs: 10458, slabs500: 18, slabsKg: 18,
  }
  const older: OrderDay = { ...recent, date: addDays(TODAY, -30), payment: 'prepaid', orders: 12 }
  const other: OrderDay = { ...recent, storeId: 'kaiven', sku: 'KV-DHS', orders: 40 }
  const unknown: OrderDay = { ...recent, payment: 'unknown', orders: 100 }

  it("is the product's own share over 30 days, whatever the sample size: another SKU or store never counts", () => {
    const at = createMetrics({ ...MOCK, orders: [recent, { ...recent, payment: 'prepaid', orders: 2 }, { ...recent, sku: 'OLD-1', payment: 'prepaid', orders: 50 }, other] })
    expect(at.codShare('kaiven', 'KV-DHS')).toMatchObject({ value: 1, basis: 'sku', n: 40, window: '30d' })
    expect(at.codShare('oorvia', 'OMS-1M')).toMatchObject({ value: 18 / 20, basis: 'sku', n: 20, window: '30d' })
    expect(at.codShare('oorvia', 'OLD-1')).toMatchObject({ value: 0, n: 50 })
  })

  it('uses every snapshot order with a known payment when the product has none in 30 days', () => {
    const at = createMetrics({ ...MOCK, orders: [older, { ...older, payment: 'cod', orders: 3 }, unknown, other] })
    expect(at.codShare('oorvia', 'OMS-1M')).toMatchObject({ value: 3 / 15, basis: 'sku', n: 15, window: 'lifetime' })
  })

  it('never borrows another product, store or the sheet: no orders yet is a null share', () => {
    for (const orders of [[], [unknown], [recent, other]]) {
      const at = createMetrics({ ...MOCK, orders })
      expect(at.codShare('selnova', 'OMS-1M')).toEqual({ value: null, basis: 'sku', n: 0, window: null, orders: 0 })
    }
    expect(createMetrics({ ...MOCK, orders: [recent] }).codShare('oorvia', 'OLD-1')).toMatchObject({ value: null, n: 0 })
  })

  it('counts the orders apart from the share, so unknown-only orders are not "no orders"', () => {
    expect(createMetrics({ ...MOCK, orders: [unknown] }).codShare('oorvia', 'OMS-1M')).toEqual({ value: null, basis: 'sku', n: 0, window: null, orders: 100 })
    expect(createMetrics({ ...MOCK, orders: [recent, unknown] }).codShare('oorvia', 'OMS-1M')).toMatchObject({ n: 18, orders: 118 })
  })

  it('breaks even under the worse of all-COD and all-prepaid when the store has no orders yet', () => {
    const at = createMetrics({ ...MOCK, orders: [] })
    const eco = at.skuEconomics('oorvia', 'OMS-1M')!
    const all = (orders: OrderDay[]) => createMetrics({ ...MOCK, orders }).skuEconomics('oorvia', 'OMS-1M')!.breakevenRoas
    expect(eco.codShare.value).toBeNull()
    expect(eco.worstCase).toBe(true)
    expect(createMetrics({ ...MOCK, orders: [recent] }).skuEconomics('oorvia', 'OMS-1M')!.worstCase).toBeUndefined()
    expect(eco.breakevenRoas).toBe(Math.max(all([recent]), all([{ ...recent, payment: 'prepaid' }])))
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
    const test: Campaign = { id: 'kv-test', storeId: 'kaiven', sku: 'KV-DHS', name: 'Zero-sale test', status: 'ACTIVE' }
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
  const bare = createMetrics({ ...MOCK, cash: null, gst: null, ownerShareMonth: null })

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

describe('Home figures from Money', () => {
  it('shows the GSTR-3B cash payable as owed', () => {
    expect(m.gst()).toEqual({ ...MOCK.gst, owed: MOCK.gst!.cash })
  })

  it('shows monthly P&L net and share directly, even without a fixed-cost run rate', () => {
    const at = createMetrics({ ...MOCK, fixedCostsRunRate: null, ownerShareMonth: { month: '2026-11', net: -25042, share: -12521 } })
    expect(at.ownerShare()).toEqual({ net: -25042, share: -12521 })
  })

  it('returns null when the P&L has a net but no share', () => {
    const at = createMetrics({ ...MOCK, ownerShareMonth: { month: '2026-11', net: 500, share: null } })
    expect(at.ownerShare()).toBeNull()
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
    expect(orphaned.rateSources(['kaiven'], week)[0].source).toMatch(/^(vxp|sheet)$/)
    expect(orphaned.rateSources(['kaiven'])).toEqual([])
  })

  it('reports the weakest source across payment types and keeps own lifetime rates out of borrowedRates', () => {
    const closed: ResolvedDay = { closedOn: TODAY, storeId: 'oorvia', sku: 'OMS-1M', payment: 'cod', delivered: 30, rto: 0 }
    const kaiven: ResolvedDay = { ...closed, storeId: 'kaiven', sku: 'KV-DHS' }
    const resolved: ResolvedDay[] = [
      closed, { ...closed, closedOn: addDays(TODAY, -30), payment: 'prepaid' }, kaiven, { ...kaiven, payment: 'prepaid' },
    ]
    const at = createMetrics({ ...MOCK, resolved })
    expect(at.rateSources()).toEqual([
      { store: STORES[0], source: 'own-lifetime' }, { store: STORES[1], source: 'own-30d' }, { store: STORES[2], source: 'vxp' },
    ])
    expect(at.borrowedRates()).toEqual([STORES[2]])
    const noPrepaid = createMetrics({ ...MOCK, resolved: resolved.filter((r) => r.payment === 'cod') })
    expect(noPrepaid.rateSources(['selnova'])).toEqual([{ store: STORES[2], source: 'sheet' }])
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
    expect(pf.total.fixedCosts).toBe(b.fixedCosts)
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

describe('VXP portfolio net profit', () => {
  const daily = MOCK.fixedCostsRunRate! * 12 / 365
  const dayFraction = (NOW_HOUR + NOW_MINUTE / 60) / 24

  it('subtracts fixed costs from current and previous contribution', () => {
    const { stores, total } = m.portfolio(resolvePeriod('7d'))
    expect(total.contribution).toBe(stores.reduce((sum, s) => sum + s.contribution, 0))
    expect(total.prevContribution).toBe(stores.reduce((sum, s) => sum + s.prev.contribution, 0))
    expect(total.fixedOnRecord).toBe(true)
    expect(total.fixedCosts).toBeCloseTo(daily * (6 + dayFraction), 6)
    expect(total.prevFixedCosts).toBeCloseTo(daily * 7, 6)
    expect(total.net).toBe(total.contribution - total.fixedCosts)
    expect(total.prevNet).toBe(total.prevContribution - total.prevFixedCosts)
  })

  it('prorates fixed costs through the same time today and yesterday', () => {
    const { total } = m.portfolio(resolvePeriod('today'))
    expect(total.fixedCosts).toBeCloseTo(daily * dayFraction, 6)
    expect(total.prevFixedCosts).toBe(total.fixedCosts)
    expect(total.prevNet).toBe(total.prevContribution - total.prevFixedCosts)
  })

  it('still counts fixed costs without any costed sales in the period', () => {
    const at = createMetrics({ ...MOCK, orders: [] })
    const { total } = at.portfolio(resolvePeriod('7d'))
    expect(total.breakeven).toBeNull()
    expect(total.fixedCosts).toBeGreaterThan(0)
    expect(total.net).toBe(-total.spend - total.fixedCosts)
  })

  it('deducts zero when no fixed costs are on record', () => {
    const at = createMetrics({ ...MOCK, fixedCostsRunRate: null })
    const { total } = at.portfolio(resolvePeriod('7d'))
    expect(total).toMatchObject({ fixedOnRecord: false, fixedCosts: 0, prevFixedCosts: 0, net: total.contribution, prevNet: total.prevContribution })
  })
})

describe('ads stopped calls', () => {
  const id = 'kaiven'
  const stopped = `${id}-ads-stopped`
  const campaign: Campaign = { id: 'kv1', storeId: id, sku: 'KV-DHS', name: 'Scalp – Broad', status: 'ACTIVE' }
  const spend = (daysAgo: number, amount: number, campaignId = campaign.id): CampaignDay => ({
    date: addDays(TODAY, -daysAgo), storeId: id, campaignId, sku: campaign.sku,
    spend: amount, impressions: 1000, clicks: 10, metaPurchases: 0, attributedOrders: 0,
  })
  /** `metaAge`: Kaiven's own Meta sync age; null = never synced. Other stores stay as MOCK has them. */
  const calls = (campaignDays: CampaignDay[], campaigns = [campaign], metaAge: number | null = 4, others: Partial<Record<string, number>> = {}) => {
    const byStore = { ...MOCK.sync.metaMinutesAgoByStore, ...others } as Record<string, number | undefined>
    if (metaAge === null) delete byStore[id]; else byStore[id] = metaAge
    return createMetrics({ ...MOCK, orders: [], cash: null, campaignDays, campaigns, sync: { ...MOCK.sync, metaMinutesAgoByStore: byStore } }).calls(resolvePeriod('7d'), [id])
  }
  const drop = [spend(4, 5354), spend(3, 5354), spend(2, 5354), spend(1, 28)]

  it('ignores a spend drop while Meta has not synced since IST midnight (yesterday incomplete) or is failing', () => {
    const sinceMidnight = MOCK.nowHour * 60 + MOCK.nowMinute
    expect(calls(drop, [campaign], sinceMidnight + 1).some((c) => c.id === stopped)).toBe(false)
    expect(calls(drop, [campaign], null).some((c) => c.id === stopped)).toBe(false)
    expect(calls(drop, [campaign], sinceMidnight).some((c) => c.id === stopped)).toBe(true)
  })

  it('is not muted by another store whose Meta sync is stale', () => {
    expect(calls(drop, [campaign], 4, { selnova: 5000 }).some((c) => c.id === stopped)).toBe(true)
  })

  it('stays quiet once the store has spend synced for today (ads resumed or a replacement campaign)', () => {
    expect(calls([...drop, spend(0, 300, 'new')]).some((c) => c.id === stopped)).toBe(false)
    expect(calls([spend(3, 100), spend(1, 100), spend(0, 50, 'new')], [{ ...campaign, status: 'DISAPPROVED' }]).some((c) => c.id === stopped)).toBe(false)
  })

  it.each(['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'ARCHIVED', 'DELETED'])('is not a call when the user stopped the ads himself (%s)', (status) => {
    expect(calls(drop, [{ ...campaign, status }]).some((c) => c.id === stopped)).toBe(false)
    expect(calls([spend(3, 100), spend(1, 100)], [{ ...campaign, status }]).some((c) => c.id === stopped)).toBe(false)
  })

  it('counts a drop in the campaigns still live when the user paused another one', () => {
    const out = calls([...drop, spend(4, 9000, 'old'), spend(3, 9000, 'old'), spend(1, 9000, 'old')], [campaign, { ...campaign, id: 'old', status: 'PAUSED' }])
    expect(out.find((c) => c.id === stopped)?.detail).toBe('₹28 yesterday vs ₹5,354/day before')
  })

  it.each(['DISAPPROVED', 'WITH_ISSUES', 'PENDING_BILLING_INFO'])('warns when Meta stopped every spending campaign (%s), even while Meta is stale', (status) => {
    expect(calls([spend(3, 100), spend(1, 100)], [{ ...campaign, status }], null).find((c) => c.id === stopped)?.detail).toBe(`Meta stopped the campaign (${status})`)
  })

  it("still warns when today's only spend is a stopped campaign's trickle, and names both rules", () => {
    const out = calls([...drop, spend(0, 10)], [{ ...campaign, status: 'DISAPPROVED' }])
    expect(out.find((c) => c.id === stopped)?.detail).toBe('₹28 yesterday vs ₹5,354/day before · Meta stopped the campaign (DISAPPROVED)')
  })

  it('reads a mix of Meta-stopped and user-paused campaigns as a Meta stop', () => {
    const out = calls([spend(3, 100), spend(1, 100), spend(2, 50, 'b')], [{ ...campaign, status: 'DISAPPROVED' }, { ...campaign, id: 'b', status: 'PAUSED' }])
    expect(out.find((c) => c.id === stopped)?.detail).toBe('Meta stopped the campaign (DISAPPROVED)')
  })

  it('does not read IN_PROCESS as stopped', () => {
    expect(calls([spend(3, 100), spend(1, 100)], [{ ...campaign, status: 'IN_PROCESS' }]).some((c) => c.id === stopped)).toBe(false)
  })

  it('warns on the spend drop and keeps the store loss call', () => {
    const out = calls([spend(4, 5354), spend(3, 5354), spend(2, 5354), spend(1, 28)])
    expect(out.find((c) => c.id === stopped)).toEqual({
      id: stopped, tone: 'warn', storeId: id, title: 'Kaiven ads stopped', detail: '₹28 yesterday vs ₹5,354/day before',
    })
    expect(out.some((c) => c.id === `${id}-below` || c.id === `${id}-loss`)).toBe(true)
  })

  it.each([
    ['normal spend with today at zero', [spend(4, 600), spend(3, 600), spend(2, 600), spend(1, 600)]],
    ['a baseline under ₹500/day', [spend(4, 1499), spend(1, 0)]],
    ['yesterday at exactly 10% of a ₹500/day baseline', [spend(4, 1500), spend(1, 50)]],
  ])('does not warn on %s', (_, rows) => {
    expect(calls(rows).some((c) => c.id === stopped)).toBe(false)
  })

  it('averages over the three complete days', () => {
    expect(calls([spend(2, 5354), spend(1, 28)]).find((c) => c.id === stopped)?.detail).toBe('₹28 yesterday vs ₹1,785/day before')
  })

  it('does not claim a Meta stop while an ACTIVE campaign exists that has not spent yet (a replacement)', () => {
    const out = calls([spend(7, 120), spend(1, 80)], [{ ...campaign, status: 'DISAPPROVED' }, { ...campaign, id: 'new' }])
    expect(out.some((c) => c.id === stopped)).toBe(false)
  })

  it('ignores a spend drop the Meta sync could not verify against the account total', () => {
    const at = createMetrics({
      ...MOCK, orders: [], cash: null, campaignDays: drop, campaigns: [campaign],
      sync: { ...MOCK.sync, metaYesterdayVerified: { ...MOCK.sync.metaYesterdayVerified, kaiven: false } },
    })
    expect(at.calls(resolvePeriod('7d'), [id]).some((c) => c.id === stopped)).toBe(false)
  })

  it.each(['ACTIVE', null])('does not warn when a spending campaign has status %s', (status) => {
    const out = calls([spend(2, 80), spend(1, 100, 'other')], [{ ...campaign, status: 'DISAPPROVED' }, { ...campaign, id: 'other', status }])
    expect(out.some((c) => c.id === stopped)).toBe(false)
  })

  it('requires spend in the last seven complete days even when Meta stopped the campaigns', () => {
    const out = calls([spend(8, 1000), spend(0, 1000)], [{ ...campaign, status: 'DISAPPROVED' }])
    expect(out.some((c) => c.id === stopped)).toBe(false)
  })
})

describe('ad account funds calls', () => {
  const hoursAgo = (h: number) => new Date(MOCK.now.getTime() - h * 3_600_000).toISOString()
  const acct = (over: Partial<AdAccountFunds>): AdAccountFunds => ({
    storeId: 'oorvia', accountId: '1', name: 'Oorvia-1', prepay: true, accountStatus: 1, remaining: 0, dailySpend: 4000, todaySpend: 0, runwayDays: 0,
    active: true, level: 'out', watched: true, checkedAt: hoursAgo(1), ...over,
  })
  const ids = (adAccountFunds: AdAccountFunds[], storeIds?: StoreId[]) =>
    createMetrics({ ...MOCK, orders: [], campaignDays: [], cash: null, sync: { ...MOCK.sync, vfulfillOverdueOrders: 0, vfulfillOpenShipments: 0, adAccountFunds } })
      .calls(resolvePeriod('7d'), storeIds)

  it('calls out funds (bad) and low funds (warn) in the push words, only for watched accounts', () => {
    const out = ids([acct({}), acct({ storeId: 'kaiven', accountId: '2', name: 'Kaiven', level: 'low', remaining: 2424, runwayDays: 0.6 }), acct({ storeId: 'selnova', accountId: '3', name: 'Selnova1', watched: false })])
    expect(out.find((c) => c.id === 'oorvia-funds-out')).toEqual({ id: 'oorvia-funds-out', tone: 'bad', storeId: 'oorvia', title: 'Oorvia-1 out of funds', detail: '₹0 left: Meta has stopped its ads. Add funds.' })
    expect(out.find((c) => c.id === 'kaiven-funds-low')).toMatchObject({ tone: 'warn', title: 'Kaiven low on funds' })
    expect(out.some((c) => c.id.startsWith('selnova-funds'))).toBe(false)
  })

  it('skips ok accounts and stores not asked for', () => {
    expect(ids([acct({ level: 'ok' })]).some((c) => c.id.includes('funds'))).toBe(false)
    expect(ids([acct({})], ['kaiven']).some((c) => c.id.includes('funds'))).toBe(false)
  })

  it('ranks out of funds ahead of the loss calls, so the three-call cap never cuts it', () => {
    const at = (adAccountFunds: AdAccountFunds[]) => createMetrics({ ...MOCK, orders: [], cash: null, sync: { ...MOCK.sync, vfulfillOverdueOrders: 0, vfulfillOpenShipments: 0, adAccountFunds } })
      .calls(resolvePeriod('7d'))
    expect(at([]).map((c) => c.tone)).toEqual(['bad', 'bad'])
    expect(at([acct({ storeId: 'selnova', accountId: '3', name: 'Selnova1' })]).map((c) => c.id)[0]).toBe('selnova-funds-out')
  })

  it('drops a read older than 6 hours: the check stopped, so the balance may have changed', () => {
    const at = (h: number) => ids([acct({ checkedAt: hoursAgo(h) })]).some((c) => c.id === 'oorvia-funds-out')
    expect(at(5.9)).toBe(true)
    expect(at(6.1)).toBe(false)
  })

  describe('in adsStopped (the Home verdict)', () => {
    const stopped = (adAccountFunds: AdAccountFunds[]) =>
      createMetrics({ ...MOCK, sync: { ...MOCK.sync, adAccountFunds } }).adsStopped(['oorvia'])
    const backup = acct({ accountId: '2', name: 'Oorvia-2', remaining: null, dailySpend: 0, level: 'ok', watched: false, active: false })

    it('counts a store whose spending account is out of funds, its campaign still ACTIVE (Oorvia-1, 2026-11-24)', () => {
      expect(stopped([acct({}), backup])).toEqual(['oorvia'])
    })

    it('not while another account of the store has an ACTIVE campaign, or the read is stale, unwatched or only low', () => {
      expect(stopped([acct({}), { ...backup, active: true }])).toEqual([])
      // The backup's read is stale: it may be the one still delivering.
      expect(stopped([acct({}), { ...backup, checkedAt: hoursAgo(7) }])).toEqual([])
      expect(stopped([acct({ checkedAt: hoursAgo(7) })])).toEqual([])
      expect(stopped([acct({ watched: false })])).toEqual([])
      expect(stopped([acct({ level: 'low' })])).toEqual([])
    })
  })
})

describe('adsStopped', () => {
  const campaign: Campaign = { id: 'kv1', storeId: 'kaiven', sku: 'KV-DHS', name: 'Scalp – Broad', status: 'DISAPPROVED' }
  const day = (storeId: StoreId, campaignId: string, daysAgo: number, spend: number): CampaignDay => ({
    date: addDays(TODAY, -daysAgo), storeId, campaignId, sku: 'X', spend, impressions: 1000, clicks: 10, metaPurchases: 0, attributedOrders: 0,
  })

  it('lists every stopped store by the same rule as the call, with no cap', () => {
    const at = createMetrics({ ...MOCK, cash: null, campaigns: [...MOCK.campaigns.filter((c) => c.storeId !== 'kaiven'), campaign],
      campaignDays: [...MOCK.campaignDays.filter((r) => r.storeId !== 'kaiven'), day('kaiven', 'kv1', 3, 100), day('kaiven', 'kv1', 1, 100)] })
    expect(at.adsStopped()).toEqual(['kaiven'])
    expect(at.adsStopped(['oorvia'])).toEqual([])
  })
})

describe('user-paused stores', () => {
  const id = 'kaiven'
  const campaign: Campaign = { id: 'kv1', storeId: id, sku: 'KV-DHS', name: 'Scalp – Broad', status: 'PAUSED' }
  const spend = (daysAgo: number, amount: number): CampaignDay => ({
    date: addDays(TODAY, -daysAgo), storeId: id, campaignId: campaign.id, sku: campaign.sku,
    spend: amount, impressions: 1000, clicks: 10, metaPurchases: 0, attributedOrders: 0,
  })
  // No orders, so the spend makes the store lose money in the period.
  const ids = (campaignDays: CampaignDay[], campaigns = [campaign]) =>
    createMetrics({ ...MOCK, orders: [], cash: null, campaignDays, campaigns }).calls(resolvePeriod('7d'), [id]).map((c) => c.id).filter((c) => c.startsWith(id))
  const losing = (out: string[]) => out.some((c) => c === `${id}-loss` || c === `${id}-below`)
  const paid = [spend(4, 5354), spend(3, 5354), spend(2, 5354)]

  it('drops the loss and below-breakeven calls once he paused every spending campaign and nothing spent yesterday', () => {
    expect(ids(paid)).toEqual([])
  })

  it('keeps the loss call while ads still spent yesterday, or a campaign is still ACTIVE', () => {
    expect(losing(ids([...paid, spend(1, 28)]))).toBe(true)
    expect(losing(ids(paid, [{ ...campaign, status: 'ACTIVE' }]))).toBe(true)
    expect(losing(ids(paid, [campaign, { ...campaign, id: 'new', status: 'ACTIVE' }]))).toBe(true)
  })
})

describe('vFulfill staleness calls', () => {
  const stale = (vfulfillImportDaysAgo: number | null, vfulfillDataDaysAgo: number | null) => {
    const shipmentsThrough = vfulfillDataDaysAgo === null ? null : addDays(TODAY, -vfulfillDataDaysAgo)
    const at = createMetrics({ ...MOCK, sync: { ...MOCK.sync, vfulfillImportDaysAgo, vfulfillDataDaysAgo, shipmentsThrough } })
    return at.calls(resolvePeriod('7d'), []).find((c) => c.id === 'vf-stale')
  }

  it.each([1, null])('uses old shipment data with import age %s', (importAge) => {
    expect(stale(importAge, 5)).toMatchObject({
      tone: 'warn', title: 'vFulfill shipments data is 5 days old',
      detail: 'Newest closed shipment 13 Nov · delivery rates and Resolved figures may be out of date',
    })
  })

  it.each([2, 5, null])('uses the import age when the shipment data age is %s', (dataAge) => {
    expect(stale(5, dataAge)?.title).toBe('vFulfill import is 5 days old')
  })

  it('says never imported only when both ages are missing and otherwise warns after three days', () => {
    expect(stale(null, null)?.title).toBe('vFulfill never imported')
    expect(stale(3, null)).toBeUndefined()
    expect(stale(null, 3)).toBeUndefined()
  })

  it('names stores left out of the last import, even while the ages look fresh', () => {
    const at = (vfulfillMissingStores: StoreId[]) =>
      createMetrics({ ...MOCK, sync: { ...MOCK.sync, vfulfillImportDaysAgo: 0, vfulfillDataDaysAgo: 1, vfulfillMissingStores } })
        .calls(resolvePeriod('7d'), []).find((c) => c.id === 'vf-stale')
    expect(at(['kaiven'])).toMatchObject({
      tone: 'warn', title: 'Kaiven not in the last vFulfill import',
      detail: "Tick every store in vFulfill's shipments export · its delivery rates and Resolved figures are out of date",
    })
    expect(at(['kaiven', 'selnova'])?.title).toBe('Kaiven and Selnova not in the last vFulfill import')
    expect(at([])).toBeUndefined()
  })

  it('stays quiet when no order is waiting on vFulfill and no recent shipment is open, however old the data', () => {
    const at = (vfulfillOverdueOrders: number | null, vfulfillOpenShipments: number | null = 0) =>
      createMetrics({ ...MOCK, sync: { ...MOCK.sync, vfulfillImportDaysAgo: 4, vfulfillDataDaysAgo: null, shipmentsThrough: '2026-09-02', vfulfillOverdueOrders, vfulfillOpenShipments } })
        .calls(resolvePeriod('7d'), []).find((c) => c.id === 'vf-stale')
    expect(at(0)).toBeUndefined()
    expect(at(0, 2)?.title).toBe('vFulfill import is 4 days old')
    expect(at(6)?.title).toBe('vFulfill import is 4 days old')
    expect(at(null)?.title).toBe('vFulfill import is 4 days old')
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

describe('Home long ranges (90D, 365D, custom)', () => {
  const at = (today: string) => createMetrics({ ...MOCK, today })

  it('90D and 365D end today and compare with the same number of days before', () => {
    expect(at('2026-11-27').resolvePeriod('90d')).toMatchObject({ from: '2026-08-30', to: '2026-11-27', prevFrom: '2026-06-01', prevTo: '2026-08-29', prevLabel: 'previous 90 days' })
    expect(at('2026-11-27').resolvePeriod('365d')).toMatchObject({ from: '2025-11-28', to: '2026-11-27', prevFrom: '2024-11-28', prevTo: '2025-11-27' })
  })

  it('a custom range compares with the same number of days just before it', () => {
    expect(at('2026-11-27').resolvePeriod('custom', { from: '2026-10-01', to: '2026-10-10' }))
      .toMatchObject({ id: 'custom', from: '2026-10-01', to: '2026-10-10', prevFrom: '2026-09-21', prevTo: '2026-09-30', prevLabel: 'previous 10 days' })
  })

  it('clamps a custom range to the last 365 days, swaps reversed ends and falls back to 7D without dates', () => {
    expect(clampCustom('2026-11-27', '2020-01-01', '2030-01-01')).toEqual({ from: '2025-11-28', to: '2026-11-27' })
    expect(clampCustom('2026-11-27', '2026-11-20', '2026-11-10')).toEqual({ from: '2026-11-10', to: '2026-11-20' })
    expect(clampCustom('2026-11-27', 'nope', '2026-11-10')).toBeNull()
    expect(at('2026-11-27').resolvePeriod('custom', {}).id).toBe('7d')
  })

  it('reads enough history for the period and its comparison', () => {
    expect(historyDaysFor('30d')).toBeGreaterThanOrEqual(60)
    expect(historyDaysFor('90d')).toBeGreaterThanOrEqual(180)
    expect(historyDaysFor('365d')).toBeGreaterThanOrEqual(730)
  })

  it('sizes a custom read to the validated range and its comparison, not to the largest bucket', () => {
    const t = '2026-11-27'
    expect(historyDaysFor('custom', t, { from: t, to: t })).toBe(70)
    expect(historyDaysFor('custom', t, { from: '2026-10-29', to: t })).toBe(70) // 30 days + 30 before: 60
    expect(historyDaysFor('custom', t, { from: '2026-09-09', to: t })).toBe(180) // 80 + 80: 160
    expect(historyDaysFor('custom', t, { from: '2026-01-01', to: '2026-01-31' })).toBe(730)
    expect(historyDaysFor('custom', t, { from: '2020-01-01', to: t })).toBe(730) // clamped to 365 + 365
    expect(historyDaysFor('custom', t, { from: '2026-04-31', to: t })).toBe(70) // unreadable: shows 7D
    // The read reaches the comparison's first day.
    const p = at(t).resolvePeriod('custom', { from: '2026-09-09', to: t })
    expect(p.prevFrom >= addDays(t, -historyDaysFor('custom', t, { from: '2026-09-09', to: t }))).toBe(true)
  })

  it('a long series matches the per-day totals and the capped comparison', () => {
    const p = resolvePeriod('month')
    const ids = STORES.map((s) => s.id)
    const pts = series(ids, p)
    const day = pts[3]
    expect(day.revenue).toBeCloseTo(m.portfolio({ ...p, from: day.key, to: day.key }).total.revenue, 6)
    const prevAll = m.portfolio({ ...p, from: p.prevFrom, to: p.prevTo }).total.revenue
    expect(pts.at(-1)!.prevCumRevenue).toBeCloseTo(prevAll, 6)
  })

  it('COD share ignores rows older than the 70-day snapshot, so a long read leaves it unchanged', () => {
    const row: OrderDay = { date: addDays(TODAY, -40), storeId: 'oorvia', sku: 'OMS-1M', payment: 'cod', orders: 6, units: 6, revenue: 1, cogs: 1, slabs500: 6, slabsKg: 6 }
    const ancient: OrderDay = { ...row, date: addDays(TODAY, -300), payment: 'prepaid', orders: 500 }
    expect(createMetrics({ ...MOCK, orders: [row, ancient] }).codShare('oorvia', 'OMS-1M'))
      .toEqual(createMetrics({ ...MOCK, orders: [row] }).codShare('oorvia', 'OMS-1M'))
  })

  it('carries orders per bucket and the previous period\'s orders', () => {
    const p = resolvePeriod('30d')
    const ids = STORES.map((s) => s.id)
    const pf = m.portfolio(p)
    expect(series(ids, p).reduce((t, x) => t + x.orders, 0)).toBeCloseTo(pf.total.orders, 6)
    expect(pf.total.prevOrders).toBe(pf.stores.reduce((t, s) => t + s.prev.orders, 0))
  })
})

describe("yesterday's hourly spend", () => {
  it('is complete when its hours add up to the daily total, and short when the daily total holds more', () => {
    const y = addDays(MOCK.today, -1)
    const hours = MOCK.campaignHoursYesterday.filter((r) => r.storeId === 'oorvia')
    const total = hours.reduce((s, r) => s + r.spend, 0)
    const day = MOCK.campaignDays.find((r) => r.storeId === 'oorvia')!
    const only = (spend: number) => ({ ...MOCK, campaignHoursYesterday: hours, campaignDays: [{ ...day, date: y, spend }] })
    expect(createMetrics(only(total)).yesterdayHoursComplete(['oorvia'])).toBe(true)
    expect(createMetrics(only(total + 0.5)).yesterdayHoursComplete(['oorvia'])).toBe(true) // rounding
    expect(createMetrics(only(total + 50)).yesterdayHoursComplete(['oorvia'])).toBe(false)
  })
})

describe('custom range dates must be real days', () => {
  it('rejects a date JavaScript would roll over (31 April is not 1 May)', () => {
    expect(clampCustom('2026-11-27', '2026-04-31', '2026-05-01')).toBeNull()
    expect(clampCustom('2026-11-27', '2026-02-29', '2026-03-01')).toBeNull()
    expect(clampCustom('2028-11-27', '2028-02-29', '2028-03-01')).toEqual({ from: '2028-02-29', to: '2028-03-01' })
  })
})

describe('range labels', () => {
  it('name the years when a range crosses one', () => {
    expect(createMetrics({ ...MOCK, today: '2026-11-27' }).resolvePeriod('365d').range).toBe('28 Nov 2025 – 27 Nov 2026')
    expect(createMetrics({ ...MOCK, today: '2026-11-27' }).resolvePeriod('90d').range).toBe('30 Aug – 27 Nov')
  })
})
