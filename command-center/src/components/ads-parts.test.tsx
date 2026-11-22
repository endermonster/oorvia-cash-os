import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { campaignStats, dailyAds, storeAds, type AdsCampaign, type CampaignStats } from '@/lib/ads'
import { fromCpa } from '@/lib/calculator'
import { AdsStatsRow, AdsVerdict, CampaignsTable, DailyTable, StoreAdsTable } from './AdsParts'

const BE = fromCpa(1499, 400) // breakeven 3.75×, target 5.52×
const camps: AdsCampaign[] = [
  { id: 'A', storeId: 'kaiven', adAccountId: '1874064503928537', name: 'KV-DHS_BCT', status: 'ACTIVE', sku: 'KV-DHS' },
  { id: 'B', storeId: 'kaiven', adAccountId: null, name: 'Old handle', status: 'PAUSED', sku: null },
]
const days = [
  { date: '2026-11-20', campaignId: 'A', spendPaise: 40_000, impressions: 1000, clicks: 25, purchases: 1 },
  { date: '2026-11-21', campaignId: 'B', spendPaise: 10_000, impressions: 500, clicks: 5, purchases: 0 },
]
const orders = [
  { storeId: 'kaiven' as const, date: '2026-11-20', campaignId: 'A', totalPaise: 149_900 },
  { storeId: 'kaiven' as const, date: '2026-11-21', campaignId: null, totalPaise: 149_900 },
]
const name = () => 'Kaiven'
const period = '7D'
const range = '15 Nov – 21 Nov'
const campaignRows = campaignStats(camps, days, orders, () => BE)
const [store] = storeAds(['kaiven'], camps, days, orders, () => BE)

const campaignMarkup = (rows: CampaignStats[]) => renderToStaticMarkup(
  <CampaignsTable rows={rows} sort="spend" sortHref={(k) => `/ads?sort=${k}`} storeName={name} showStore={false} period={period} />,
)

const verdictMarkup = (rows: CampaignStats[], notConnected: string[] = []) => renderToStaticMarkup(
  <AdsVerdict t={{ ...store, spendPaise: rows.reduce((sum, row) => sum + row.spendPaise, 0) }} be={BE} single rows={rows} range={range} period={period} scope="Kaiven" months={null} notConnected={notConnected} allDisconnected={notConnected.length === 1} />,
)

describe('Ads parts', () => {
  it('campaign table: zone against breakeven, Ads Manager link, warning for an unmatched URL', () => {
    const html = campaignMarkup(campaignRows)
    expect(html).toContain('3.75×') // ₹1,499 on ₹400: covering costs
    expect(html).toContain('Covering costs')
    expect(html).toContain('selected_campaign_ids=A')
    expect(html).toContain('URL matches no product')
    expect(html).toContain('Spend ↓')
    expect(html).toContain('aria-sort="descending"')
    expect(html).toMatch(/<a\b(?=[^>]*aria-current="true")(?=[^>]*href="\/ads\?sort=spend")[^>]*>Spend<\/a>/)
    expect(html).toContain('BE ₹400 / unit')
  })

  it('store table and stats show tracked orders and breakeven', () => {
    expect(renderToStaticMarkup(<StoreAdsTable rows={[store]} storeName={name} period={period} />)).toContain('50% tracked')
    const stats = renderToStaticMarkup(<AdsStatsRow t={store} be={BE} single period={period} />)
    expect(stats).toContain('1 of 2')
    expect(stats).toContain('breakeven ₹400 per order')
    const verdict = verdictMarkup(campaignRows)
    expect(verdict).toContain('BE 3.75×')
    expect(verdict).toContain('ROAS · all orders · Meta + Shopify')
  })

  it('leads with below-breakeven spend, above-target count and tracked share', () => {
    const [base] = campaignRows
    const html = verdictMarkup([
      { ...base, zone: 'below', spendPaise: 20_000 },
      { ...base, id: 'C', zone: 'below', spendPaise: 15_000 },
      { ...base, id: 'D', zone: 'profit', spendPaise: 15_000 },
    ])
    expect(html).toContain('₹350 of ₹500 spend is in 2 campaigns below breakeven. 1 campaign is above target.')
    expect(html).toContain('Campaign ROAS counts tracked orders only (1 of 2).')
    expect(verdictMarkup([base])).toContain('No campaign is below breakeven. 1 campaign is covering costs.')
    expect(verdictMarkup([])).toContain(`No ads ran in ${range}.`)
  })

  it('reports when spending campaigns are all too early to judge', () => {
    const earlyDays = [{ ...days[0], spendPaise: 10_000 }]
    const html = verdictMarkup(campaignStats(camps, earlyDays, [], () => BE))
    expect(html).toContain('>1 campaign is too early to judge.</h1>')
  })

  it('reports when spending campaigns all lack cost data', () => {
    const html = verdictMarkup(campaignStats(camps, days, orders, () => null))
    expect(html).toContain('>No cost data for 2 campaigns.</h1>')
  })

  it('reports confirmed results alongside campaigns that lack cost data', () => {
    const html = verdictMarkup(campaignRows)
    expect(html).toContain('>1 campaign is covering costs. No cost data for 1 campaign.</h1>')
  })

  it('reports a disconnected Meta account when there is no recorded spend', () => {
    const html = verdictMarkup([], ['Kaiven'])
    expect(html).toContain('>Meta not connected.</h1>')
    expect(html).not.toContain('No ads ran')
  })

  it.each([
    [{ zone: 'profit' }, 'Scale', 'text-good'],
    [{ zone: 'covering' }, 'Hold', 'text-revenue'],
    [{ zone: 'below' }, 'Cut or fix', 'text-bad'],
    [{ zone: 'early' }, 'Too early', 'text-ink-2'],
    [{ sku: null, be: null, zone: null }, 'Check URL', 'text-warn'],
    [{ be: null, zone: null }, 'Add cost', 'text-warn'],
    [{ roas: null, sku: null, be: null, zone: null }, 'No spend', 'text-ink-2'],
    [{ be: fromCpa(1499, 0), zone: 'below' }, 'Cut or fix', 'text-bad'],
  ] satisfies [Partial<CampaignStats>, string, string][])('renders the campaign call for %j', (patch, word, colour) => {
    const html = campaignMarkup([{ ...campaignRows[0], ...patch }])
    expect(html).toMatch(new RegExp(`ring-1 ${colour}[^>]*>${word}</span>`))
  })

  it('colours CPA by the ROAS verdict and keeps the per-unit breakeven', () => {
    const base = { ...campaignRows[0], cpa: 500 }
    expect(campaignMarkup([base])).not.toMatch(/text-bad">₹500/)
    const below = campaignMarkup([{ ...base, zone: 'below' }])
    expect(below).toMatch(/text-bad">₹500/)
    expect(below).toContain('BE ₹400 / unit')
  })

  it('daily table lists each day', () => {
    const html = renderToStaticMarkup(<DailyTable rows={dailyAds('2026-11-20', '2026-11-21', days, orders)} range={range} period={period} />)
    expect(html.indexOf('21 Nov')).toBeLessThan(html.indexOf('20 Nov'))
    expect(html).toContain('1,000 impressions · 25 link clicks · 1 Meta purchase</div>')
    expect(html).toContain('500 impressions · 5 link clicks · 0 Meta purchases')
  })
})
