import { describe, expect, it } from 'vitest'
import { adsManagerUrl, campaignStats, dailyAds, monthDays, sortCampaigns, spendWeightedBreakeven, storeAds, type AdsCampaign, type AdsMetaDay, type AdsOrder, type CampaignStats } from './ads'
import { fromCpa } from './calculator'

// Price paid ₹1,499, ₹400 profit before ads per order: breakeven ROAS 3.75×, target (3.75/1.18 + 1.5) × 1.18 = 5.52×.
const BE = fromCpa(1499, 400)
const LOSS = fromCpa(1499, -50)

const camp = (id: string, over: Partial<AdsCampaign> = {}): AdsCampaign =>
  ({ id, storeId: 'kaiven', adAccountId: '1874064503928537', name: id, status: 'ACTIVE', sku: 'KV-DHS', ...over })
const day = (campaignId: string, date: string, rupees: number, over: Partial<AdsMetaDay> = {}): AdsMetaDay =>
  ({ date, campaignId, spendPaise: rupees * 100, impressions: 1000, clicks: 20, purchases: 1, ...over })
const order = (campaignId: string | null, date: string, rupees = 1499, storeId: AdsOrder['storeId'] = 'kaiven'): AdsOrder =>
  ({ storeId, date, campaignId, totalPaise: rupees * 100 })

const eco = () => BE

describe('campaignStats', () => {
  it('sums Meta days and attributed orders per campaign', () => {
    const [c] = campaignStats([camp('A')], [day('A', '2026-11-20', 300), day('A', '2026-11-21', 500)], [order('A', '2026-11-20'), order('A', '2026-11-21'), order(null, '2026-11-21')], eco)
    expect(c.spendPaise).toBe(80000)
    expect(c.impressions).toBe(2000)
    expect(c.metaPurchases).toBe(2)
    expect(c.orders).toBe(2) // the untracked order belongs to no campaign
    expect(c.cpa).toBe(400)
    expect(c.roas).toBeCloseTo(2998 / 800)
    expect(c.cpm).toBe(400)
    expect(c.ctr).toBeCloseTo(0.02)
    expect(c.url).toContain('act=1874064503928537')
  })

  it('drops campaigns with neither spend nor orders, keeps an orders-only one with no ROAS', () => {
    const rows = campaignStats([camp('A'), camp('B'), camp('C')], [day('A', '2026-11-20', 0)], [order('B', '2026-11-20')], eco)
    expect(rows.map((r) => r.id)).toEqual(['B'])
    expect(rows[0].roas).toBeNull()
    expect(rows[0].zone).toBeNull()
  })

  it('zones against the product breakeven and target', () => {
    const zone = (orders: number, rupees: number, e = BE) =>
      campaignStats([camp('A')], [day('A', '2026-11-20', rupees)], Array.from({ length: orders }, () => order('A', '2026-11-20')), () => e)[0].zone
    expect(zone(1, 1499)).toBe('below') // 1.0×
    expect(zone(1, 350)).toBe('covering') // 4.28×
    expect(zone(1, 200)).toBe('profit') // 7.5×
    expect(zone(0, 300)).toBe('early') // under one breakeven CPA, no order yet
    expect(zone(0, 500)).toBe('below') // a full breakeven CPA spent for nothing
    expect(zone(0, 100, LOSS)).toBe('below') // loses money before ads: never "early"
  })

  it('has no breakeven when the URL matches no product', () => {
    const [c] = campaignStats([camp('A', { sku: null })], [day('A', '2026-11-20', 300)], [], () => { throw new Error('not called') })
    expect(c.be).toBeNull()
    expect(c.zone).toBeNull()
  })
})

describe('storeAds', () => {
  it('counts every order for ROAS and the tracked ones separately', () => {
    const [k, o] = storeAds(['kaiven', 'oorvia'], [camp('A'), camp('B', { storeId: 'oorvia' })],
      [day('A', '2026-11-20', 1000), day('B', '2026-11-20', 50)],
      [order('A', '2026-11-20'), order(null, '2026-11-20'), order(null, '2026-11-20', 999, 'oorvia')], () => BE)
    expect(k).toMatchObject({ spendPaise: 100000, orders: 2, trackedOrders: 1, revenuePaise: 299800, cpa: 500 })
    expect(k.roas).toBeCloseTo(2.998)
    expect(k.zone).toBe('below')
    expect(o).toMatchObject({ spendPaise: 5000, orders: 1, trackedOrders: 0 })
  })
})

describe('dailyAds', () => {
  it('lists every day newest first, zero days included', () => {
    const rows = dailyAds('2026-11-19', '2026-11-21', [day('A', '2026-11-19', 200), day('A', '2026-11-30', 999)], [order('A', '2026-11-21'), order(null, '2026-11-21')])
    expect(rows.map((r) => r.date)).toEqual(['2026-11-21', '2026-11-20', '2026-11-19'])
    expect(rows[0]).toMatchObject({ orders: 2, trackedOrders: 1, spendPaise: 0, roas: null })
    expect(rows[2]).toMatchObject({ spendPaise: 20000, orders: 0, roas: 0 })
  })
})

describe('sortCampaigns', () => {
  const row = (id: string, spendPaise: number, cpa: number | null, roas: number | null) => ({ id, spendPaise, orders: 0, cpa, roas }) as CampaignStats
  const rows = [row('a', 100, 500, 2), row('b', 300, null, null), row('c', 200, 300, 4)]
  it('sorts spend and ROAS largest first, CPA cheapest first, nulls last', () => {
    expect(sortCampaigns(rows, 'spend').map((r) => r.id)).toEqual(['b', 'c', 'a'])
    expect(sortCampaigns(rows, 'roas').map((r) => r.id)).toEqual(['c', 'a', 'b'])
    expect(sortCampaigns(rows, 'cpa').map((r) => r.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('spendWeightedBreakeven', () => {
  it('is the spend-weighted mean of breakeven ROAS: products each at their own breakeven make the store break even', () => {
    // Two ₹1,000 products, breakeven CPA ₹100 (10×) and ₹500 (2×), ₹500 spend each: at their breakevens the store does 6×.
    const rows = campaignStats(
      [camp('A'), camp('B', { sku: 'KV-2' }), camp('C', { storeId: 'oorvia' }), camp('D', { sku: 'NONE' })],
      [day('A', '2026-08-01', 500), day('B', '2026-08-01', 500), day('C', '2026-08-01', 999), day('D', '2026-08-01', 500)], [],
      (_, sku) => (sku === 'KV-DHS' ? fromCpa(1000, 100) : sku === 'KV-2' ? fromCpa(1000, 500) : null),
    )
    expect(spendWeightedBreakeven(rows, 'kaiven')!.breakevenRoas).toBeCloseTo(6) // other stores and uncosted products left out
    expect(spendWeightedBreakeven(rows, 'selnova')).toBeNull()
  })

  it('cannot break even while a product with spend loses money before ads', () => {
    const rows = campaignStats([camp('A'), camp('B', { sku: 'KV-2' })], [day('A', '2026-08-01', 500), day('B', '2026-08-01', 50)], [],
      (_, sku) => (sku === 'KV-DHS' ? BE : LOSS))
    expect(spendWeightedBreakeven(rows, 'kaiven')!.breakevenRoas).toBe(Infinity)
  })
})

describe('helpers', () => {
  it('monthDays covers the whole month', () => {
    expect(monthDays('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthDays('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' })
  })
  it('adsManagerUrl strips act_ and needs an account', () => {
    expect(adsManagerUrl('act_123', '9')).toBe('https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123&selected_campaign_ids=9')
    expect(adsManagerUrl(null, '9')).toBeNull()
  })
})
