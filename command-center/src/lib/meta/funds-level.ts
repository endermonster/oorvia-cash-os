/**
 * Ad account funds rules, pure: shared by the funds check (./funds.ts, push alerts) and the dashboard (metrics `calls()`),
 * so the phone and Needs your call always say the same thing.
 *
 * Remaining funds = spend_cap − amount_spent. Meta's own "available balance" (funding_source_details) is refused to the
 * system user tokens (#10), and `balance` reads 0. Verified 2026-11-24: Oorvia-1 ran out of funds with its cap exactly
 * equal to its amount spent.
 */
import type { AdAccountFunds, StoreId } from '../types'

/** Runway under this many days at the 7-day average spend is "low". */
export const FUNDS_LOW_DAYS = 3

/** A read older than this is not shown: the check runs every 2 hours, so three missed runs means it has stopped. */
export const FUNDS_STALE_HOURS = 6

export const fundsFresh = (checkedAt: string, now: Date): boolean => now.getTime() - Date.parse(checkedAt) <= FUNDS_STALE_HOURS * 3_600_000

export type FundsLevel = AdAccountFunds['level']

const STATUS: Record<number, string> = {
  2: 'disabled', 3: 'unsettled', 7: 'pending risk review', 8: 'pending settlement', 9: 'in its grace period', 100: 'pending closure', 101: 'closed',
}

/** One cc_ad_account_funds row (amounts in paise). */
export type FundsRow = {
  account_id: string; store_id: string; name: string; account_status: number; is_prepay: boolean
  spend_cap_paise: number; amount_spent_paise: number; daily_spend_paise: number; today_spend_paise: number; active_campaigns: boolean; checked_at: string
}

type Read = Pick<AdAccountFunds, 'accountStatus' | 'remaining' | 'dailySpend' | 'todaySpend' | 'active'>

/** Billing statuses where Meta still runs the ads (pending settlement, grace period): a warning, not a stop. */
const STILL_RUNNING = new Set([8, 9])

export function fundsLevel(r: Omit<Read, 'todaySpend'>): FundsLevel {
  if (r.remaining !== null && r.remaining <= 0) return 'out'
  if (r.accountStatus !== 1 && !STILL_RUNNING.has(r.accountStatus)) return 'out'
  if (STILL_RUNNING.has(r.accountStatus)) return 'low'
  const days = runwayDays(r)
  return days !== null && days < FUNDS_LOW_DAYS ? 'low' : 'ok'
}

export const runwayDays = (r: Pick<Read, 'remaining' | 'dailySpend'>): number | null =>
  r.remaining === null || r.dailySpend <= 0 ? null : Math.max(0, r.remaining) / r.dailySpend

/**
 * The level is worth a call: the account spent in the last 7 days or today, and it has an ACTIVE campaign. With every
 * campaign paused he stopped the ads himself, so low funds is not a decision yet. A billing problem needs only the spend.
 * Today's spend counts so an account that resumes after a quiet week and runs dry the same day is not missed.
 */
export const fundsWatched = (r: Read): boolean => (r.dailySpend > 0 || r.todaySpend > 0) && (r.active || r.accountStatus !== 1)

export function mapFundsRow(r: FundsRow): AdAccountFunds {
  const cap = Number(r.spend_cap_paise)
  const read: Read = {
    accountStatus: Number(r.account_status),
    remaining: cap > 0 ? (cap - Number(r.amount_spent_paise)) / 100 : null,
    dailySpend: Number(r.daily_spend_paise) / 100,
    todaySpend: Number(r.today_spend_paise ?? 0) / 100,
    active: r.active_campaigns,
  }
  return {
    storeId: r.store_id as StoreId, accountId: r.account_id, name: r.name, prepay: r.is_prepay !== false, ...read,
    runwayDays: runwayDays(read), level: fundsLevel(read), watched: fundsWatched(read), checkedAt: r.checked_at,
  }
}

const rupees = (n: number) => `₹${Math.max(0, Math.round(n)).toLocaleString('en-IN')}`
const runwayText = (days: number) => (days < 1 ? 'less than a day' : `about ${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'}`)

/** The push and the call, in the same words. `level` ok is the "back to OK" message after a top-up. */
export function fundsMessage(a: Pick<AdAccountFunds, 'name' | 'prepay' | 'accountStatus' | 'remaining' | 'runwayDays'>, level: FundsLevel): { title: string; body: string } {
  if (level === 'out' && a.accountStatus !== 1 && !STILL_RUNNING.has(a.accountStatus)) {
    return { title: `${a.name} ad account ${STATUS[a.accountStatus] ?? `status ${a.accountStatus}`}`, body: 'Meta stops its ads until this is fixed. Open Billing in Ads Manager.' }
  }
  if (level === 'low' && STILL_RUNNING.has(a.accountStatus)) {
    return { title: `${a.name} ad account ${STATUS[a.accountStatus]}`, body: 'Ads still run, but Meta stops them if billing is not settled. Settle it in Billing soon.' }
  }
  // Card-funded: the cap is a spending limit he set, so the fix is raising it, not adding funds.
  if (level === 'out' && !a.prepay) return { title: `${a.name} hit its spending limit`, body: 'Meta has stopped its ads. Raise or reset the limit in Billing.' }
  if (level === 'out') return { title: `${a.name} out of funds`, body: `${rupees(a.remaining ?? 0)} left: Meta has stopped its ads. Add funds.` }
  const left = a.remaining === null ? 'No spending limit' : `${rupees(a.remaining)} left${a.prepay ? '' : ' before the spending limit'}`
  const runway = a.runwayDays === null ? '' : `, ${runwayText(a.runwayDays)} at current spend`
  if (level === 'low' && !a.prepay) return { title: `${a.name} near its spending limit`, body: `${left}${runway}. Raise the limit in Billing.` }
  if (level === 'low') return { title: `${a.name} low on funds`, body: `${left}${runway}. Add funds.` }
  return { title: `${a.name} funds OK`, body: `${left}${runway}.` }
}

/**
 * What the funds check does with a new read, given the level last alerted: `store` is the level to keep, `push` the
 * message to send (null = none). A change on a watched account pushes. An unwatched account (no spend, or every campaign
 * paused) never pushes low or out; it is quietly reset to ok when its funds recover, with a push only after a top-up
 * (remaining went up since the last read). `pending` is a push that failed last run: it is sent again while the account
 * is still at that level (and, for low or out, still watched), so a failed "funds OK" is not lost once the new balance
 * becomes the baseline, and a warning is not sent after he paused every campaign.
 */
export function alertFor(
  prev: FundsLevel, cur: Pick<AdAccountFunds, 'level' | 'watched' | 'remaining'>, prevRemaining: number | null, pending: FundsLevel | null = null,
): { store: FundsLevel; push: FundsLevel | null } {
  const a = decide(prev, cur, prevRemaining)
  const retry = a.push === null && pending !== null && pending === cur.level && (pending === 'ok' || cur.watched)
  return retry ? { store: cur.level, push: pending } : a
}

function decide(prev: FundsLevel, cur: Pick<AdAccountFunds, 'level' | 'watched' | 'remaining'>, prevRemaining: number | null): { store: FundsLevel; push: FundsLevel | null } {
  if (cur.level === prev) return { store: prev, push: null }
  if (cur.watched) return { store: cur.level, push: cur.level }
  if (cur.level !== 'ok') return { store: prev, push: null }
  const toppedUp = cur.remaining !== null && prevRemaining !== null && cur.remaining > prevRemaining
  return { store: 'ok', push: toppedUp ? 'ok' : null }
}
