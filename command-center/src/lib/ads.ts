/**
 * The Ads tab: every campaign's Meta numbers against the Shopify orders that carry its campaign ID, and each
 * against its product's breakeven. Pure: rows in, figures out. Money in paise; breakeven CPA (calculator) in ₹.
 *
 * Campaign ROAS counts only attributed orders (decided 2026-11-21): an order without a campaign ID belongs to
 * no campaign, so a campaign's ROAS understates by the untracked share, which the page shows. A store's ROAS
 * counts every order, as on Home.
 */
import { breaksEven, fromCpa, roasZone, type Breakeven, type RoasZone } from './calculator'
import { addDays } from './dates'
import { shiftMonth } from './orders'
import type { StoreId } from './types'

export type AdsCampaign = { id: string; storeId: StoreId; adAccountId: string | null; name: string; status: string | null; sku: string | null }
export type AdsMetaDay = { date: string; campaignId: string; spendPaise: number; impressions: number; clicks: number; purchases: number }
/** One counted Shopify order (cancelled and test orders already left out). */
export type AdsOrder = { storeId: StoreId; date: string; campaignId: string | null; totalPaise: number }

/**
 * `below` breakeven, `covering` (breakeven to target), `profit` (above target); `early` when no order yet and
 * less than one breakeven CPA spent, so zero ROAS says nothing.
 */
export type AdsZone = RoasZone | 'early'

type Counts = { spendPaise: number; impressions: number; clicks: number; metaPurchases: number; orders: number; revenuePaise: number }

export type CampaignStats = AdsCampaign & Counts & {
  /** ₹ per attributed order; null with no orders. */
  cpa: number | null
  /** Attributed revenue ÷ spend (Meta's scale, incl. GST); null with no spend. */
  roas: number | null
  cpm: number | null
  ctr: number | null
  /** The product's breakeven at today's costs and delivery rates; null when the URL matches no product or it has no cost. */
  be: Breakeven | null
  zone: AdsZone | null
  /** Meta's link for this campaign; null when the ad account isn't known. */
  url: string | null
}

export type StoreAds = Counts & {
  storeId: StoreId
  /** Orders carrying a campaign ID (`orders` counts every order). */
  trackedOrders: number
  roas: number | null
  cpa: number | null
  be: Breakeven | null
  zone: RoasZone | null
}

export type AdsDay = Counts & { date: string; trackedOrders: number; roas: number | null }

export type SortKey = 'spend' | 'orders' | 'cpa' | 'roas'
export const SORTS: SortKey[] = ['spend', 'orders', 'cpa', 'roas']

const zero = (): Counts => ({ spendPaise: 0, impressions: 0, clicks: 0, metaPurchases: 0, orders: 0, revenuePaise: 0 })
const ratio = (a: number, b: number) => (b > 0 ? a / b : null)

export function adsManagerUrl(adAccountId: string | null, campaignId: string): string | null {
  if (!adAccountId) return null
  const act = adAccountId.replace(/^act_/, '')
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(act)}&selected_campaign_ids=${encodeURIComponent(campaignId)}`
}

export function campaignZone(roas: number | null, orders: number, spendPaise: number, be: Breakeven | null): AdsZone | null {
  if (be === null || roas === null) return null
  if (orders === 0 && breaksEven(be) && spendPaise / 100 < be.breakevenCpa) return 'early'
  return roasZone(roas, be)
}

/**
 * Per campaign: Meta's numbers in the range plus its attributed orders. A campaign shows if it spent or had an
 * attributed order (orders can land on a day with no spend). Orders whose campaign ID is unknown stay untracked.
 */
export function campaignStats(
  campaigns: AdsCampaign[], days: AdsMetaDay[], orders: AdsOrder[], economics: (storeId: StoreId, sku: string) => Breakeven | null,
): CampaignStats[] {
  const by = new Map<string, Counts>()
  const get = (id: string) => by.get(id) ?? by.set(id, zero()).get(id)!
  for (const r of days) {
    const c = get(r.campaignId)
    c.spendPaise += r.spendPaise; c.impressions += r.impressions; c.clicks += r.clicks; c.metaPurchases += r.purchases
  }
  for (const o of orders) {
    if (o.campaignId === null) continue
    const c = get(o.campaignId)
    c.orders += 1; c.revenuePaise += o.totalPaise
  }
  return campaigns.flatMap((camp) => {
    const c = by.get(camp.id)
    if (!c || (c.spendPaise === 0 && c.orders === 0)) return []
    const be = camp.sku === null ? null : economics(camp.storeId, camp.sku)
    const roas = ratio(c.revenuePaise, c.spendPaise)
    return [{
      ...camp, ...c,
      cpa: ratio(c.spendPaise / 100, c.orders),
      roas,
      cpm: ratio(c.spendPaise / 100 * 1000, c.impressions),
      ctr: ratio(c.clicks, c.impressions),
      be,
      zone: campaignZone(roas, c.orders, c.spendPaise, be),
      url: adsManagerUrl(camp.adAccountId, camp.id),
    }]
  })
}

/** Per store: all its campaigns' spend against every order it took, tracked or not. */
export function storeAds(
  storeIds: StoreId[], campaigns: AdsCampaign[], days: AdsMetaDay[], orders: AdsOrder[], economics: (storeId: StoreId) => Breakeven | null,
): StoreAds[] {
  const storeOf = new Map(campaigns.map((c) => [c.id, c.storeId]))
  return storeIds.map((storeId) => {
    const t = { ...zero(), trackedOrders: 0 }
    for (const r of days) {
      if (storeOf.get(r.campaignId) !== storeId) continue
      t.spendPaise += r.spendPaise; t.impressions += r.impressions; t.clicks += r.clicks; t.metaPurchases += r.purchases
    }
    for (const o of orders) {
      if (o.storeId !== storeId) continue
      t.orders += 1; t.revenuePaise += o.totalPaise
      if (o.campaignId !== null) t.trackedOrders += 1
    }
    const be = economics(storeId)
    const roas = ratio(t.revenuePaise, t.spendPaise)
    return { storeId, ...t, roas, cpa: ratio(t.spendPaise / 100, t.orders), be, zone: be === null || roas === null ? null : roasZone(roas, be) }
  })
}

/** One row per day of the range, newest first, zeros included so a day with no spend shows as one. */
export function dailyAds(from: string, to: string, days: AdsMetaDay[], orders: AdsOrder[]): AdsDay[] {
  const out = new Map<string, AdsDay>()
  for (let d = to; d >= from; d = addDays(d, -1)) out.set(d, { date: d, ...zero(), trackedOrders: 0, roas: null })
  for (const r of days) {
    const x = out.get(r.date)
    if (!x) continue
    x.spendPaise += r.spendPaise; x.impressions += r.impressions; x.clicks += r.clicks; x.metaPurchases += r.purchases
  }
  for (const o of orders) {
    const x = out.get(o.date)
    if (!x) continue
    x.orders += 1; x.revenuePaise += o.totalPaise
    if (o.campaignId !== null) x.trackedOrders += 1
  }
  for (const x of out.values()) x.roas = ratio(x.revenuePaise, x.spendPaise)
  return [...out.values()]
}

/**
 * A store's breakeven over the products its campaigns sold in the range, for a past month whose mix is not today's:
 * the ROAS at which the store breaks even when every product spends what it did and earns its own breakeven ROAS,
 * i.e. the spend-weighted mean of the products' breakeven ROAS. Each product is weighted by the orders its spend
 * buys at breakeven (spend ÷ breakeven CPA), so price ÷ CPA of the blend comes out as that mean.
 * A product that loses money before ads breaks even at no ROAS, and so does the blend. Null when no campaign
 * with a costed product spent.
 */
export function spendWeightedBreakeven(camps: CampaignStats[], storeId: StoreId): Breakeven | null {
  const rows = camps.filter((c) => c.storeId === storeId && c.be !== null && c.spendPaise > 0)
  if (rows.length === 0) return null
  const loser = rows.find((c) => !breaksEven(c.be!))
  if (loser) return fromCpa(loser.be!.avgPricePaid, loser.be!.breakevenCpa)
  const w = rows.map((c) => c.spendPaise / c.be!.breakevenCpa)
  const total = w.reduce((s, x) => s + x, 0)
  return fromCpa(rows.reduce((s, c, i) => s + (w[i] / total) * c.be!.avgPricePaid, 0), rows.reduce((s, c, i) => s + (w[i] / total) * c.be!.breakevenCpa, 0))
}

/** Nulls last whatever the direction; ties by spend. CPA sorts cheapest first, the rest largest first. */
export function sortCampaigns(rows: CampaignStats[], key: SortKey): CampaignStats[] {
  const val = (c: CampaignStats) => (key === 'spend' ? c.spendPaise : key === 'orders' ? c.orders : key === 'cpa' ? c.cpa : c.roas)
  const asc = key === 'cpa'
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b)
    if (x === null || y === null) return x === y ? b.spendPaise - a.spendPaise : x === null ? 1 : -1
    return x === y ? b.spendPaise - a.spendPaise : asc ? x - y : y - x
  })
}

/** First and last day (YYYY-MM-DD) of a YYYY-MM month. */
export function monthDays(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: addDays(`${shiftMonth(month, 1)}-01`, -1) }
}
