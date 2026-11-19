import { describe, expect, it } from 'vitest'
import { applyAlias, canonicalize, creativeLinks, handleFromUrl, hourOf, mapDay, mapHour, purchasesOf, resolveHandles, toCount, toPaise } from './map'

describe('toPaise / toCount', () => {
  it('turns a rupee string into integer paise, rounding', () => {
    expect(toPaise('1234.56')).toBe(123456)
    expect(toPaise('0.29')).toBe(29)
    expect(toPaise('10')).toBe(1000)
    expect(toPaise('0.006')).toBe(1)
  })
  it('treats missing or junk as 0', () => {
    expect(toPaise(undefined)).toBe(0)
    expect(toPaise('abc')).toBe(0)
    expect(toCount(undefined)).toBe(0)
    expect(toCount('1200')).toBe(1200)
  })
})

describe('purchasesOf', () => {
  const a = (action_type: string, value: string) => ({ action_type, value })
  it('prefers omni_purchase and never sums the overlapping types', () => {
    expect(purchasesOf([a('purchase', '5'), a('omni_purchase', '7'), a('offsite_conversion.fb_pixel_purchase', '5')])).toBe(7)
  })
  it('falls back to purchase, then the pixel purchase', () => {
    expect(purchasesOf([a('purchase', '5'), a('offsite_conversion.fb_pixel_purchase', '4')])).toBe(5)
    expect(purchasesOf([a('link_click', '9'), a('offsite_conversion.fb_pixel_purchase', '4')])).toBe(4)
  })
  it('is 0 with none', () => {
    expect(purchasesOf(undefined)).toBe(0)
    expect(purchasesOf([a('link_click', '9')])).toBe(0)
  })
})

describe('hourOf', () => {
  it('reads the start hour of a bucket', () => {
    expect(hourOf('13:00:00 - 13:59:59')).toBe(13)
    expect(hourOf('00:00:00 - 00:59:59')).toBe(0)
    expect(hourOf('23:00:00 - 23:59:59')).toBe(23)
  })
  it('is null for anything else', () => {
    expect(hourOf(undefined)).toBeNull()
    expect(hourOf('noon')).toBeNull()
    expect(hourOf('24:00:00 - 24:59:59')).toBeNull()
  })
})

describe('mapDay / mapHour', () => {
  const row = {
    campaign_id: '1', campaign_name: 'C', spend: '250.50', impressions: '1000', inline_link_clicks: '40',
    actions: [{ action_type: 'omni_purchase', value: '2' }], date_start: '2026-11-18',
  }
  it('maps a day row', () => {
    expect(mapDay(row)).toEqual({ campaign_id: '1', date: '2026-11-18', spend_paise: 25050, impressions: 1000, clicks: 40, purchases: 2 })
  })
  it('uses 0 clicks when inline_link_clicks is absent', () => {
    expect(mapDay({ ...row, inline_link_clicks: undefined }).clicks).toBe(0)
  })
  it('maps an hour row and skips one with no readable bucket', () => {
    expect(mapHour({ ...row, hourly_stats_aggregated_by_advertiser_time_zone: '13:00:00 - 13:59:59' })?.hour).toBe(13)
    expect(mapHour(row)).toBeNull()
  })
})

describe('handleFromUrl', () => {
  it('extracts and normalises the product handle', () => {
    expect(handleFromUrl('https://oorvia.com/products/Hair-Serum?utm_source=fb#top')).toBe('hair-serum')
    expect(handleFromUrl('https://oorvia.com/products/hair-serum/')).toBe('hair-serum')
    expect(handleFromUrl('https://oorvia.com/products/mug%2Dset')).toBe('mug-set')
    expect(handleFromUrl('https://oorvia.com/collections/all/products/hair-serum')).toBe('hair-serum')
  })
  it('ignores another myshopify store but accepts a custom domain and the stores own domain', () => {
    expect(handleFromUrl('https://other.myshopify.com/products/a', 'mine.myshopify.com')).toBeNull()
    expect(handleFromUrl('https://mine.myshopify.com/products/a', 'mine.myshopify.com')).toBe('a')
    expect(handleFromUrl('https://oorvia.com/products/a', 'mine.myshopify.com')).toBe('a')
    expect(handleFromUrl('https://other.myshopify.com/products/a')).toBe('a')
  })
  it('gives no handle for collection, home or junk URLs', () => {
    expect(handleFromUrl('https://oorvia.com/collections/hair')).toBeNull()
    expect(handleFromUrl('https://oorvia.com/')).toBeNull()
    expect(handleFromUrl('https://oorvia.com/products/')).toBeNull()
  })
})

describe('creativeLinks', () => {
  it('collects links from every known place', () => {
    const links = creativeLinks({
      object_story_spec: {
        link_data: { link: 'a', child_attachments: [{ link: 'b' }, { link: 'c' }] },
        video_data: { call_to_action: { value: { link: 'd' } } },
      },
      asset_feed_spec: { link_urls: [{ website_url: 'e' }] },
      link_url: 'f', object_url: 'g', template_url: 'h',
    })
    expect(links).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  })
  it('is empty with no creative', () => {
    expect(creativeLinks(undefined)).toEqual([])
  })
})

describe('resolveHandles', () => {
  const ad = (campaign_id: string, ...links: string[]) => ({ campaign_id, creative: { object_story_spec: { link_data: { child_attachments: links.map((link) => ({ link })) } } } })
  it('resolves one distinct handle across ads, even repeated', () => {
    const r = resolveHandles([ad('1', 'https://x.com/products/a?x=1'), ad('1', 'https://x.com/products/A/')])
    expect(r.get('1')).toEqual({ kind: 'one', handle: 'a' })
  })
  it('is none for a campaign whose ads link to no product page', () => {
    expect(resolveHandles([ad('2', 'https://x.com/collections/all'), { campaign_id: '2' }]).get('2')).toEqual({ kind: 'none' })
  })
  it('is ambiguous for two products', () => {
    expect(resolveHandles([ad('3', 'https://x.com/products/b'), ad('3', 'https://x.com/products/a')]).get('3')).toEqual({ kind: 'ambiguous', handles: ['a', 'b'] })
  })
})

describe('applyAlias', () => {
  it('translates a renamed handle and leaves others alone', () => {
    const m = new Map([['old', 'new']])
    expect(applyAlias('old', m)).toBe('new')
    expect(applyAlias('other', m)).toBe('other')
  })
  it('follows chains, up to 5 hops', () => {
    const m = new Map([['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e'], ['e', 'f'], ['f', 'g']])
    expect(applyAlias('a', m)).toBe('f')
  })
  it('stops at a handle that is a live product again, even mid-chain', () => {
    const m = new Map([['a', 'b'], ['b', 'c']])
    expect(applyAlias('a', m, new Set(['a']))).toBe('a')
    expect(applyAlias('a', m, new Set(['b']))).toBe('b')
    expect(applyAlias('a', m, new Set(['c']))).toBe('c')
  })
  it('canonicalize: merges old and new handles of one product, keeps two products ambiguous', () => {
    const m = new Map([['old', 'new']])
    expect(canonicalize({ kind: 'ambiguous', handles: ['new', 'old'] }, m)).toEqual({ kind: 'one', handle: 'new' })
    expect(canonicalize({ kind: 'ambiguous', handles: ['old', 'other'] }, m)).toEqual({ kind: 'ambiguous', handles: ['new', 'other'] })
    expect(canonicalize({ kind: 'one', handle: 'old' }, m)).toEqual({ kind: 'one', handle: 'new' })
    expect(canonicalize({ kind: 'one', handle: 'old' }, m, new Set(['old']))).toEqual({ kind: 'one', handle: 'old' })
    expect(canonicalize({ kind: 'none' }, m)).toEqual({ kind: 'none' })
  })
  it('stops at a cycle instead of looping', () => {
    const m = new Map([['a', 'b'], ['b', 'a']])
    expect(applyAlias('a', m)).toBe('b')
  })
})
