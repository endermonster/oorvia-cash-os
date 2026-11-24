import 'server-only'
import { addDays, istNow } from '../dates'
import { dbError } from '../db-error'
import { selectAll } from '../paged'
import { supabase } from '../supabase'
import { withLock, type Lock } from '../sync-lock'
import { withRun } from '../sync-run'
import { accountsOf, type AdAccount } from './accounts'
import { graphGet, graphGetAll, MetaError, type CallOpts } from './client'
import {
  applyAlias, canonicalize, mapDay, mapHour, resolveHandles, toPaise, type Ad, type CampaignDayOut, type CampaignHourOut, type HandleResult, type InsightRow,
} from './map'

const INSIGHT_FIELDS = 'campaign_id,campaign_name,spend,impressions,inline_link_clicks,actions'
const HOURLY = 'hourly_stats_aggregated_by_advertiser_time_zone'
const BATCH = 500
/** Meta revises recent days and counts 7-day-click purchases late: the default window re-pulls a week. */
const DEFAULT_WINDOW_DAYS = 7
/**
 * Meta hides archived campaigns and ads unless asked. DELETED is left out of these two lists: both edges answer it
 * with code 100. Verified live on Oorvia-1: campaigns 34 -> 42, ads 285 -> 336.
 */
const CAMPAIGN_STATUSES = ['ACTIVE', 'PAUSED', 'ARCHIVED', 'IN_PROCESS', 'WITH_ISSUES']
const AD_STATUSES = ['ACTIVE', 'PAUSED', 'ARCHIVED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED', 'PENDING_BILLING_INFO', 'IN_PROCESS', 'WITH_ISSUES']
/** Insights status filter: includes deleted campaigns (their spend is real), which the campaign edge cannot list. */
const INSIGHT_STATUSES = [...CAMPAIGN_STATUSES, 'DELETED', 'CAMPAIGN_PAUSED']
/** A day whose campaign rows and account total differ by more than this (paise) makes the stale delete unsafe. */
const TOTAL_TOLERANCE_PAISE = 100
const ADS_CHUNK = 50
const DEFAULT_LOCK_TTL_MS = 15 * 60_000

type AccountInfo = { name?: string; currency?: string; timezone_name?: string; account_status?: number }
type CampaignInfo = { id: string; name: string; effective_status?: string }
type StoredCampaign = { campaign_id: string; landing_handle: string | null }

export type AccountStatus = 'ok' | 'no_access' | 'wrong_currency' | 'wrong_timezone'
export type AccountResult = {
  account: string; name: string; status: AccountStatus
  campaigns: number; day_rows: number; hour_rows: number; spend_paise: number
}

export type MetaResult = {
  since: string
  until: string
  accounts: AccountResult[]
  campaigns: number
  day_rows: number
  hour_rows: number
  /** Total spend of the day rows fetched, in paise. */
  spend_paise: number
  /** Stored day and hour rows in the window that Meta no longer returns (deleted, or a dry run: would be). */
  stale_days_removed: number
  stale_hours_removed: number
  /** Things that need a person: an account that cannot be read, a campaign with spend and no usable product link. */
  skipped: string[]
  /** Worth knowing, not a failure (an account that is not active still has history and is synced). */
  warnings: string[]
  /** True when at least one account synced and every other one is only no_access (not shared yet); false otherwise. */
  ok: boolean
  /**
   * Yesterday is in this run's range and every account read matched its campaign spend to the account total for it.
   * The "ads stopped" call trusts a drop in yesterday's spend only then: a partial answer is not a stop.
   */
  yesterday_verified: boolean
  /** Dry run only: the campaigns that would be written. */
  plan?: { campaigns: { id: string; name: string; handle: string | null; status: string | null; spend_paise: number }[] }
}

export type MetaOpts = {
  since?: string
  dryRun?: boolean
  /** Epoch ms: one budget for every Meta call; nothing retries or waits past it, a request in flight is aborted. */
  deadlineAt?: number
  /** Per-request timeout in ms (default 60 s). */
  requestTimeoutMs?: number
  /** How long the store's sync lock lasts between renewals (default 15 min); the HTTP route passes its own limit. */
  lockTtlMs?: number
}

type CampaignOut = {
  campaign_id: string; store_id: string; ad_account_id: string; name: string; updated_at: string; status?: string | null; landing_handle?: string
}

/**
 * Pulls campaign spend from Meta for every allowlisted ad account of a store: daily rows from `since` (default:
 * the last 7 days plus today) to today, and hourly rows for today and yesterday. Stored rows in those windows that
 * Meta no longer returns are deleted. One cc_sync_runs row per store, with `result.ok` (see MetaResult.ok).
 * `dryRun` reads and plans but writes nothing, not even a cc_sync_runs row.
 */
export function syncMeta(storeId: string, opts: MetaOpts = {}): Promise<MetaResult> {
  const { today } = istNow(new Date())
  const since = opts.since ?? addDays(today, -DEFAULT_WINDOW_DAYS)
  if (opts.dryRun) return runMeta(storeId, since, today, null, opts)
  // The lock comes first: a sync turned away because another is running records no run.
  return withLock('meta', storeId, opts.lockTtlMs ?? DEFAULT_LOCK_TTL_MS, (lock) => withRun('meta', storeId, () => runMeta(storeId, since, today, lock, opts), (r) => r.ok))
}

/** `lock` is null for a dry run, which writes nothing and so takes no lock. */
async function runMeta(storeId: string, since: string, today: string, lock: Lock | null, opts: MetaOpts): Promise<MetaResult> {
  const dryRun = lock === null
  const accounts = accountsOf(storeId)
  if (accounts.length === 0) throw new Error(`Store "${storeId}" has no allowlisted Meta ad account`)
  const sb = supabase()
  const products = await selectAll<{ handle: string }>(() => sb.from('cc_products').select('handle').eq('store_id', storeId).order('handle'))
  const aliasRows = await selectAll<{ old_handle: string; handle: string }>(
    () => sb.from('cc_handle_aliases').select('old_handle, handle').eq('store_id', storeId).order('old_handle'),
  )
  const stores = await selectAll<{ shopify_domain: string | null }>(() => sb.from('cc_stores').select('shopify_domain').eq('id', storeId).order('id'))
  const ctx: Ctx = {
    storeId, since, today, dryRun, lock,
    call: { deadlineAt: opts.deadlineAt, timeoutMs: opts.requestTimeoutMs },
    productHandles: new Set(products.map((p) => p.handle)),
    aliases: new Map(aliasRows.map((a) => [a.old_handle, a.handle])),
    shopifyDomain: stores[0]?.shopify_domain ?? undefined,
  }

  const result: MetaResult = {
    since, until: today, accounts: [], campaigns: 0, day_rows: 0, hour_rows: 0, spend_paise: 0,
    stale_days_removed: 0, stale_hours_removed: 0, skipped: [], warnings: [], ok: true, yesterday_verified: since <= addDays(today, -1),
  }
  if (dryRun) result.plan = { campaigns: [] }
  for (const account of accounts) {
    const r = await runAccount(ctx, account, result)
    result.accounts.push(r)
    result.campaigns += r.campaigns
    result.day_rows += r.day_rows
    result.hour_rows += r.hour_rows
    result.spend_paise += r.spend_paise
  }
  // ok: at least one account synced and every other account's only problem is that it has not been shared yet (no_access).
  // A store where every account is no_access stays ok:false, so it stays "Meta not connected".
  result.ok = result.accounts.some((a) => a.status === 'ok') && result.accounts.every((a) => a.status === 'ok' || a.status === 'no_access')
  result.yesterday_verified = result.yesterday_verified && allAccountsRead(result.accounts)
  return result
}

/**
 * Every account of the store was read. A no_access account keeps the run ok (freshness), but its spend is missing,
 * so the store's total cannot be trusted: an account that lost access would read as "ads stopped".
 */
export const allAccountsRead = (accounts: Pick<AccountResult, 'status'>[]) => accounts.length > 0 && accounts.every((a) => a.status === 'ok')

type Ctx = {
  storeId: string; since: string; today: string; dryRun: boolean; lock: Lock | null; call: CallOpts
  productHandles: Set<string>; aliases: Map<string, string>; shopifyDomain: string | undefined
}

async function runAccount(ctx: Ctx, account: AdAccount, out: MetaResult): Promise<AccountResult> {
  const { storeId, since, today, dryRun, call } = ctx
  const label = `${account.name} (${account.id})`
  const base: AccountResult = { account: account.id, name: account.name, status: 'ok', campaigns: 0, day_rows: 0, hour_rows: 0, spend_paise: 0 }
  const problem = (status: AccountStatus, why: string): AccountResult => {
    out.skipped.push(`${label}: ${why}`)
    return { ...base, status }
  }
  const act = `act_${account.id}`

  try {
    const info = await graphGet<AccountInfo>(act, { fields: 'name,currency,timezone_name,account_status' }, call)
    if (info.currency !== 'INR') return problem('wrong_currency', `currency is ${info.currency}, not INR: skipped, its amounts would be wrong`)
    if (info.timezone_name !== 'Asia/Kolkata') return problem('wrong_timezone', `time zone is ${info.timezone_name}, not Asia/Kolkata: skipped, its dates and hours would be wrong`)
    // A disabled or closed account still has history, so it is synced; the status is only worth a warning.
    if (info.account_status !== undefined && info.account_status !== 1) out.warnings.push(`${label}: account status is ${info.account_status}, not 1 (active)`)

    const sb = supabase()
    const stored = await selectAll<StoredCampaign>(
      () => sb.from('cc_campaigns').select('campaign_id, landing_handle').eq('ad_account_id', account.id).order('campaign_id'),
    )
    const storedById = new Map(stored.map((c) => [c.campaign_id, c.landing_handle]))

    const campaigns = await graphGetAll<CampaignInfo>(`${act}/campaigns`, { fields: 'id,name,effective_status', effective_status: JSON.stringify(CAMPAIGN_STATUSES), limit: 200 }, call)
    const insightParams = { level: 'campaign', fields: INSIGHT_FIELDS, time_increment: 1, limit: 500, use_unified_attribution_setting: 'true', filtering: JSON.stringify([{ field: 'campaign.effective_status', operator: 'IN', value: INSIGHT_STATUSES }]) }
    const dayInsights = await graphGetAll<InsightRow>(`${act}/insights`, { ...insightParams, time_range: JSON.stringify({ since, until: today }) }, call)
    const hourInsights = await graphGetAll<InsightRow>(`${act}/insights`, {
      ...insightParams, breakdowns: HOURLY, time_range: JSON.stringify({ since: addDays(today, -1), until: today }),
    }, call)

    const days = dayInsights.map(mapDay)
    const hours = hourInsights.map(mapHour).filter((h): h is CampaignHourOut => h !== null)
    // Safety for the stale delete: the status-unfiltered account total must match the campaign rows, day by day.
    const accountDays = await graphGetAll<{ spend?: string; date_start: string }>(`${act}/insights`, {
      level: 'account', fields: 'spend', time_increment: 1, limit: 500, use_unified_attribution_setting: 'true', time_range: JSON.stringify({ since, until: today }),
    }, call)
    const mismatch = totalsMismatch(accountDays, days)
    // Today's account total lags its campaign rows while spend comes in (seen live: off one run, matching the next).
    // Any mismatch still blocks the delete; only one on an earlier day is reported.
    const pastMismatch = mismatch && totalsMismatch(accountDays.filter((a) => a.date_start !== today), days.filter((d) => d.date !== today))
    const hourGap = hours.length !== hourInsights.length
    const yesterday = addDays(today, -1)
    if (totalsMismatch(accountDays.filter((a) => a.date_start === yesterday), days.filter((d) => d.date === yesterday))) out.yesterday_verified = false

    const spendBy = new Map<string, number>()
    for (const d of days) spendBy.set(d.campaign_id, (spendBy.get(d.campaign_id) ?? 0) + d.spend_paise)

    // Campaigns: the list, plus any the insights mention that it does not (deleted ones), named from the insights.
    const now = new Date().toISOString()
    const byId = new Map<string, CampaignOut>()
    const listed = new Set(campaigns.map((c) => c.id))
    const row = (id: string, name: string): CampaignOut => ({ campaign_id: id, store_id: storeId, ad_account_id: account.id, name, updated_at: now })
    for (const c of campaigns) byId.set(c.id, { ...row(c.id, c.name), status: c.effective_status ?? null })
    // Not in the list: gone from Meta's side. Its stored status is left alone (no status key at all).
    for (const i of [...dayInsights, ...hourInsights]) if (!byId.has(i.campaign_id)) byId.set(i.campaign_id, row(i.campaign_id, i.campaign_name ?? i.campaign_id))

    // Ads are read only for campaigns that are new, have no stored handle, or spent in the window.
    const needAds = [...byId.keys()].filter((id) => listed.has(id) && (!storedById.has(id) || !storedById.get(id) || (spendBy.get(id) ?? 0) > 0))
    const ads: Ad[] = []
    for (let i = 0; i < needAds.length; i += ADS_CHUNK) {
      const filtering = JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: needAds.slice(i, i + ADS_CHUNK) }])
      ads.push(...await graphGetAll<Ad>(`${act}/ads`, {
        fields: 'campaign_id,creative{object_story_spec,asset_feed_spec,link_url,object_url,template_url}', filtering, effective_status: JSON.stringify(AD_STATUSES), limit: 100,
      }, call))
    }
    const handles = resolveHandles(ads, ctx.shopifyDomain)

    // landing_handle is set only when resolved to exactly one handle (after aliases); otherwise the stored value stays.
    // Campaigns that had spend in the window and cannot be tied to a product of this store are reported.
    for (const c of byId.values()) {
      const who = `campaign "${c.name}" (${c.campaign_id}) in ${account.name}`
      const spent = (spendBy.get(c.campaign_id) ?? 0) > 0
      if (!listed.has(c.campaign_id)) {
        if (spent && !storedById.get(c.campaign_id)) out.skipped.push(`${who} was deleted: its ads are gone, so it cannot be tied to a product`)
        continue
      }
      const h: HandleResult = canonicalize(handles.get(c.campaign_id) ?? { kind: 'none' }, ctx.aliases, ctx.productHandles)
      if (h.kind === 'one') c.landing_handle = h.handle
      else {
        // Not re-read (no spend, handle already stored): a stored handle that has since been renamed still moves to the new one.
        const old = storedById.get(c.campaign_id)
        if (old && applyAlias(old, ctx.aliases, ctx.productHandles) !== old) c.landing_handle = applyAlias(old, ctx.aliases, ctx.productHandles)
      }
      if (!spent) continue
      if (h.kind === 'none') out.skipped.push(`${who} has spend but its ads link to no product page`)
      else if (h.kind === 'ambiguous') out.skipped.push(`${who} links to ${h.handles.length} products: ${h.handles.join(', ')}`)
      else if (!ctx.productHandles.has(c.landing_handle!)) out.skipped.push(`${who} links to /products/${c.landing_handle}, which matches no product of ${storeId}`)
    }

    const spend = days.reduce((n, d) => n + d.spend_paise, 0)
    const result: AccountResult = { ...base, campaigns: byId.size, day_rows: days.length, hour_rows: hours.length, spend_paise: spend }

    // The fetch above succeeded in full, so a stored row in the window that Meta did not return is stale.
    // ...unless the fetch cannot be trusted to be complete: then rows are still written, and nothing is deleted.
    const stale = await findStale(account.id, since, today, days, hours)
    if (mismatch) {
      if (pastMismatch) out.skipped.push(`${label}: campaign spend does not match the account total (${pastMismatch}): stale rows were not deleted`)
      else out.warnings.push(`${label}: today's campaign spend does not match the account total yet (${mismatch}): stale rows were not deleted this run`)
      stale.days = []
      stale.hours = []
    } else if (hourGap) {
      out.skipped.push(`${label}: an hourly row had no readable hour bucket: stale hour rows were not deleted`)
      stale.hours = []
    } else {
      // The hours must add up to each day's spend, or an empty or partial hourly answer would erase stored hours.
      // Today's hours can lag like the account total: still kept, but only an earlier day is reported.
      const hourMismatch = hoursMismatch(days, hours, yesterday)
      if (hourMismatch) {
        const notToday = <T extends { date: string }>(rows: T[]) => rows.filter((r) => r.date !== today)
        const past = hoursMismatch(notToday(days), notToday(hours), yesterday)
        if (past) out.skipped.push(`${label}: hourly spend does not add up to the day's spend (${past}): stale hour rows were not deleted`)
        else out.warnings.push(`${label}: today's hourly spend does not add up to the day's spend yet (${hourMismatch}): stale hour rows were not deleted this run`)
        stale.hours = []
      }
    }
    out.stale_days_removed += stale.days.reduce((n, g) => n + g.values.length, 0)
    out.stale_hours_removed += stale.hours.reduce((n, g) => n + g.values.length, 0)

    if (dryRun) {
      for (const c of byId.values()) out.plan!.campaigns.push({ id: c.campaign_id, name: c.name, handle: c.landing_handle ?? storedById.get(c.campaign_id) ?? null, status: c.status ?? null, spend_paise: spendBy.get(c.campaign_id) ?? 0 })
      return result
    }
    await ctx.lock!.renew() // still ours: nothing else has synced this store since this run read its snapshot
    await write([...byId.values()], days, hours)
    await removeStale(stale)
    return result
  } catch (e) {
    if (e instanceof MetaError && e.kind === 'no_access') {
      return problem('no_access', `no access: the token in ${account.tokenEnv} cannot read this account; assign it to that portfolio's system user with View performance`)
    }
    throw e
  }
}

// ── Stale rows ───────────────────────────────────────────────────────────────

/** Null when every day's summed campaign spend is within tolerance of the account's; else a short description of the first day that is not. */
export function totalsMismatch(account: { spend?: string; date_start: string }[], campaignDays: CampaignDayOut[]): string | null {
  const acc = new Map<string, number>()
  for (const a of account) acc.set(a.date_start, (acc.get(a.date_start) ?? 0) + toPaise(a.spend))
  const camp = new Map<string, number>()
  for (const d of campaignDays) camp.set(d.date, (camp.get(d.date) ?? 0) + d.spend_paise)
  for (const date of [...new Set([...acc.keys(), ...camp.keys()])].sort()) {
    const a = acc.get(date) ?? 0
    const c = camp.get(date) ?? 0
    if (Math.abs(a - c) > TOTAL_TOLERANCE_PAISE) return `${date}: account ${(a / 100).toFixed(2)} vs campaigns ${(c / 100).toFixed(2)}`
  }
  return null
}

/** Null when, for every date from `from` on, the hourly rows add up to the daily rows within 100 paise; else the first date that does not. */
export function hoursMismatch(days: CampaignDayOut[], hours: CampaignHourOut[], from: string): string | null {
  const sum = (rows: CampaignDayOut[]) => {
    const m = new Map<string, number>()
    for (const r of rows) if (r.date >= from) m.set(r.date, (m.get(r.date) ?? 0) + r.spend_paise)
    return m
  }
  const d = sum(days)
  const h = sum(hours)
  for (const date of [...new Set([...d.keys(), ...h.keys()])].sort()) {
    const a = d.get(date) ?? 0
    const b = h.get(date) ?? 0
    if (Math.abs(a - b) > TOTAL_TOLERANCE_PAISE) return `${date}: daily ${(a / 100).toFixed(2)} vs hourly ${(b / 100).toFixed(2)}`
  }
  return null
}

type DayGroup = { campaign_id: string; values: string[] }
type HourGroup = { campaign_id: string; date: string; values: number[] }

/** Stored day rows in [since, today] and hour rows in [yesterday, today] of this ad account that the fetch did not return. */
async function findStale(accountId: string, since: string, today: string, days: CampaignDayOut[], hours: CampaignHourOut[]) {
  const sb = supabase()
  const gotDays = new Set(days.map((d) => `${d.campaign_id}|${d.date}`))
  const gotHours = new Set(hours.map((h) => `${h.campaign_id}|${h.date}|${h.hour}`))
  const storedDays = await selectAll<{ campaign_id: string; date: string }>(
    () => sb.from('cc_campaign_days').select('campaign_id, date, cc_campaigns!inner(ad_account_id)')
      .eq('cc_campaigns.ad_account_id', accountId).gte('date', since).lte('date', today).order('campaign_id').order('date'),
  )
  const storedHours = await selectAll<{ campaign_id: string; date: string; hour: number }>(
    () => sb.from('cc_campaign_hours').select('campaign_id, date, hour, cc_campaigns!inner(ad_account_id)')
      .eq('cc_campaigns.ad_account_id', accountId).gte('date', addDays(today, -1)).lte('date', today).order('campaign_id').order('date').order('hour'),
  )
  const dayMap = new Map<string, string[]>()
  for (const r of storedDays) if (!gotDays.has(`${r.campaign_id}|${r.date}`)) dayMap.set(r.campaign_id, [...(dayMap.get(r.campaign_id) ?? []), r.date])
  const hourMap = new Map<string, HourGroup>()
  for (const r of storedHours) {
    if (gotHours.has(`${r.campaign_id}|${r.date}|${Number(r.hour)}`)) continue
    const key = `${r.campaign_id}|${r.date}`
    const g = hourMap.get(key) ?? { campaign_id: r.campaign_id, date: r.date, values: [] }
    g.values.push(Number(r.hour))
    hourMap.set(key, g)
  }
  return {
    days: [...dayMap].map(([campaign_id, values]): DayGroup => ({ campaign_id, values })),
    hours: [...hourMap.values()],
  }
}

async function removeStale(stale: { days: DayGroup[]; hours: HourGroup[] }): Promise<void> {
  const sb = supabase()
  for (const g of stale.days) {
    const { error, status } = await sb.from('cc_campaign_days').delete().eq('campaign_id', g.campaign_id).in('date', g.values)
    if (error) throw dbError('cc_campaign_days', error, status)
  }
  for (const g of stale.hours) {
    const { error, status } = await sb.from('cc_campaign_hours').delete().eq('campaign_id', g.campaign_id).eq('date', g.date).in('hour', g.values)
    if (error) throw dbError('cc_campaign_hours', error, status)
  }
}

// ── Writes ───────────────────────────────────────────────────────────────────

async function upsertBatches(table: string, rows: object[], onConflict: string): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error, status } = await supabase().from(table).upsert(rows.slice(i, i + BATCH), { onConflict })
    if (error) throw dbError(table, error, status)
  }
}

/** Campaigns first (the day and hour rows reference them). Rows are grouped by which columns they carry, so a campaign with no resolved handle or no known status keeps its stored value instead of being nulled. */
async function write(campaigns: CampaignOut[], days: CampaignDayOut[], hours: CampaignHourOut[]): Promise<void> {
  const groups = new Map<string, CampaignOut[]>()
  for (const c of campaigns) {
    const key = Object.keys(c).sort().join(',')
    groups.set(key, [...(groups.get(key) ?? []), c])
  }
  for (const rows of groups.values()) await upsertBatches('cc_campaigns', rows, 'campaign_id')
  const synced_at = new Date().toISOString()
  await upsertBatches('cc_campaign_days', days.map((d) => ({ ...d, synced_at })), 'campaign_id,date')
  await upsertBatches('cc_campaign_hours', hours.map((h) => ({ ...h, synced_at })), 'campaign_id,date,hour')
}
