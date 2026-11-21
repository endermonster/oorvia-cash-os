import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { campaignStats, dailyAds, storeAds, type AdsCampaign } from '@/lib/ads'
import { fromCpa } from '@/lib/calculator'
import { AdsStatsRow, CampaignsTable, DailyTable, StoreAdsTable } from './AdsParts'

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

describe('Ads parts', () => {
  it('campaign table: zone against breakeven, Ads Manager link, warning for an unmatched URL', () => {
    const html = renderToStaticMarkup(<CampaignsTable rows={campaignStats(camps, days, orders, () => BE)} sort="spend" sortHref={(k) => `/ads?sort=${k}`} storeName={name} showStore={false} />)
    expect(html).toContain('3.75×') // ₹1,499 on ₹400: covering costs
    expect(html).toContain('Covering costs')
    expect(html).toContain('selected_campaign_ids=A')
    expect(html).toContain('URL matches no product')
    expect(html).toContain('Spend ↓')
  })

  it('store table and stats show tracked orders and breakeven', () => {
    const [s] = storeAds(['kaiven'], camps, days, orders, () => BE)
    expect(renderToStaticMarkup(<StoreAdsTable rows={[s]} storeName={name} />)).toContain('50%')
    const stats = renderToStaticMarkup(<AdsStatsRow t={s} be={BE} single />)
    expect(stats).toContain('1 of 2')
    expect(stats).toContain('breakeven 3.75× · target 5.52×')
  })

  it('daily table lists each day', () => {
    const html = renderToStaticMarkup(<DailyTable rows={dailyAds('2026-11-20', '2026-11-21', days, orders)} />)
    expect(html.indexOf('21 Nov')).toBeLessThan(html.indexOf('20 Nov'))
  })
})
