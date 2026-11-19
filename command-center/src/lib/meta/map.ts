/**
 * Pure mapping from Meta Graph API shapes onto the cc_campaign* rows. No I/O.
 */

export type Action = { action_type: string; value: string }

/** One insights row at level=campaign. `hourly_stats_aggregated_by_advertiser_time_zone` is present only on hourly requests. */
export type InsightRow = {
  campaign_id: string
  campaign_name?: string
  spend?: string
  impressions?: string
  inline_link_clicks?: string
  actions?: Action[]
  date_start: string
  hourly_stats_aggregated_by_advertiser_time_zone?: string
}

export type CampaignDayOut = {
  campaign_id: string; date: string; spend_paise: number; impressions: number; clicks: number; purchases: number
}
export type CampaignHourOut = CampaignDayOut & { hour: number }

/** "1234.56" -> 123456. Rounds; a missing or unparseable value is 0. */
export function toPaise(spend: string | undefined): number {
  const n = Number(spend)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

/** A count Meta sends as a string. Missing or unparseable is 0. */
export function toCount(v: string | number | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/**
 * Purchases: `omni_purchase` if present, else `purchase`, else `offsite_conversion.fb_pixel_purchase`.
 * Never summed: the types overlap (the same purchase is counted under several).
 */
export function purchasesOf(actions: Action[] | undefined): number {
  for (const type of ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase']) {
    const a = actions?.find((x) => x.action_type === type)
    if (a) return toCount(a.value)
  }
  return 0
}

/** "13:00:00 - 13:59:59" -> 13. Null if the text is not an hour bucket. */
export function hourOf(bucket: string | undefined): number | null {
  const m = /^(\d{1,2}):\d{2}:\d{2}\s*-/.exec(bucket ?? '')
  if (!m) return null
  const h = Number(m[1])
  return h >= 0 && h <= 23 ? h : null
}

const amounts = (r: InsightRow) => ({
  campaign_id: r.campaign_id, date: r.date_start,
  spend_paise: toPaise(r.spend), impressions: toCount(r.impressions), clicks: toCount(r.inline_link_clicks), purchases: purchasesOf(r.actions),
})

export const mapDay = (r: InsightRow): CampaignDayOut => amounts(r)

/** Null when the row has no readable hour bucket. */
export function mapHour(r: InsightRow): CampaignHourOut | null {
  const hour = hourOf(r.hourly_stats_aggregated_by_advertiser_time_zone)
  return hour === null ? null : { ...amounts(r), hour }
}

// ── Landing handle ───────────────────────────────────────────────────────────

/** The shape of an ad's creative as the Graph API returns it (only what is read). */
export type Creative = {
  object_story_spec?: {
    link_data?: { link?: string; child_attachments?: { link?: string }[] }
    video_data?: { call_to_action?: { value?: { link?: string } } }
  }
  asset_feed_spec?: { link_urls?: { website_url?: string }[] }
  link_url?: string
  object_url?: string
  template_url?: string
}
export type Ad = { campaign_id?: string; creative?: Creative }

/** Every destination URL an ad creative carries. */
export function creativeLinks(c: Creative | undefined): string[] {
  if (!c) return []
  const s = c.object_story_spec
  const all = [
    s?.link_data?.link,
    ...(s?.link_data?.child_attachments ?? []).map((x) => x.link),
    s?.video_data?.call_to_action?.value?.link,
    ...(c.asset_feed_spec?.link_urls ?? []).map((x) => x.website_url),
    c.link_url, c.object_url, c.template_url,
  ]
  return all.filter((x): x is string => typeof x === 'string' && x.length > 0)
}

/**
 * `/products/{handle}` out of a URL: query, fragment and trailing slash dropped, URL-decoded, lowercased. Collection and
 * home URLs give null. With the store's own myshopify domain given, a link to ANOTHER *.myshopify.com store is ignored;
 * any other host is taken as the store's custom domain, which cannot be known here.
 */
export function handleFromUrl(raw: string, storeDomain?: string): string | null {
  let url: URL
  try {
    url = new URL(raw, 'https://placeholder.invalid')
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (storeDomain && host.endsWith('.myshopify.com') && host !== storeDomain.toLowerCase()) return null
  const m = /\/products\/([^/]+)/i.exec(url.pathname)
  if (!m) return null
  let h = m[1]
  try { h = decodeURIComponent(h) } catch { /* keep the raw segment */ }
  h = h.trim().toLowerCase()
  return h === '' ? null : h
}

/**
 * Follows renames (old handle -> new handle) for up to 5 hops, stopping at a cycle. An unaliased handle comes back
 * unchanged, and so does one that is a current product handle (`live`): a stale alias must not redirect a live product.
 */
export function applyAlias(handle: string, aliases: Map<string, string>, live?: ReadonlySet<string>): string {
  const seen = new Set<string>([handle])
  let h = handle
  for (let hop = 0; hop < 5; hop++) {
    if (live?.has(h)) break
    const next = aliases.get(h)
    if (next === undefined || seen.has(next)) break
    seen.add(next)
    h = next
  }
  return h
}

export type HandleResult = { kind: 'one'; handle: string } | { kind: 'none' } | { kind: 'ambiguous'; handles: string[] }

/**
 * A campaign's handles after aliases, so ads on a product's old and new handle count as one product. The result's
 * handle is already translated.
 */
export function canonicalize(r: HandleResult, aliases: Map<string, string>, live?: ReadonlySet<string>): HandleResult {
  if (r.kind === 'none') return r
  const handles = [...new Set((r.kind === 'one' ? [r.handle] : r.handles).map((h) => applyAlias(h, aliases, live)))].sort()
  return handles.length === 1 ? { kind: 'one', handle: handles[0] } : { kind: 'ambiguous', handles }
}

/** Per campaign: exactly one distinct handle across its ads -> that handle; none -> none; two or more -> ambiguous. */
export function resolveHandles(ads: Ad[], storeDomain?: string): Map<string, HandleResult> {
  const byCampaign = new Map<string, Set<string>>()
  for (const ad of ads) {
    if (!ad.campaign_id) continue
    const set = byCampaign.get(ad.campaign_id) ?? new Set<string>()
    for (const link of creativeLinks(ad.creative)) {
      const h = handleFromUrl(link, storeDomain)
      if (h) set.add(h)
    }
    byCampaign.set(ad.campaign_id, set)
  }
  return new Map([...byCampaign].map(([id, set]) => {
    const handles = [...set].sort()
    const r: HandleResult = handles.length === 1 ? { kind: 'one', handle: handles[0] } : handles.length === 0 ? { kind: 'none' } : { kind: 'ambiguous', handles }
    return [id, r]
  }))
}
