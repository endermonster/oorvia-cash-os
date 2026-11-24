import 'server-only'
import { addDays, istNow } from '../dates'
import { dbError } from '../db-error'
import { notify } from '../ntfy'
import { selectAll } from '../paged'
import { supabase } from '../supabase'
import { withRun } from '../sync-run'
import { AD_ACCOUNTS, type AdAccount } from './accounts'
import { graphGet, graphGetAll, MetaError, type CallOpts } from './client'
import { alertFor, fundsMessage, mapFundsRow, type FundsLevel, type FundsRow } from './funds-level'
import { toPaise } from './map'

/** A push gets this long; with the route's 45 s Meta deadline that leaves time to save before the 60 s kill. */
const PUSH_TIMEOUT_MS = 5_000

type Stored = FundsRow & { alert_level: FundsLevel; pending_push: FundsLevel | null }
type Info = { currency?: string; account_status?: number; is_prepay_account?: boolean; spend_cap?: string; amount_spent?: string }

export type FundsAccountResult = {
  account: string; name: string; status: 'ok' | 'no_access' | 'error'
  level?: FundsLevel; watched?: boolean; remaining?: number | null; runway_days?: number | null
  /** The push sent (or, in a dry run, that would be). */
  pushed?: FundsLevel | null
  error?: string
}
export type FundsResult = { dry_run: boolean; ok: boolean; accounts: FundsAccountResult[] }

/**
 * Reads the funds of every allowlisted ad account (3 small calls each), stores the read in cc_ad_account_funds and pushes
 * to ntfy when an account's level changes (see alertFor). `dryRun` reads Meta only: no writes, no push, no run row.
 */
export function checkFunds(opts: { dryRun?: boolean; call?: CallOpts } = {}): Promise<FundsResult> {
  const run = () => runFunds(opts.dryRun === true, opts.call ?? {})
  return opts.dryRun ? run() : withRun('meta_funds', null, run, (r) => r.ok)
}

async function runFunds(dryRun: boolean, call: CallOpts): Promise<FundsResult> {
  const sb = supabase()
  const stored = new Map((await selectAll<Stored>(() => sb.from('cc_ad_account_funds')
    .select('account_id, store_id, name, account_status, is_prepay, spend_cap_paise, amount_spent_paise, daily_spend_paise, today_spend_paise, active_campaigns, checked_at, alert_level, pending_push')
    .order('account_id'))).map((r) => [r.account_id, r]))
  const out: FundsResult = { dry_run: dryRun, ok: true, accounts: [] }
  for (const account of AD_ACCOUNTS) {
    try {
      const r = await checkAccount(account, stored.get(account.id), dryRun, call)
      // The read is saved, but a push that did not go out is a failed run: the alert was the point.
      if (r.error) out.ok = false
      out.accounts.push(r)
    } catch (e) {
      if (e instanceof MetaError && e.kind === 'no_access') {
        out.accounts.push({ account: account.id, name: account.name, status: 'no_access' })
        continue
      }
      out.ok = false
      out.accounts.push({ account: account.id, name: account.name, status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }
  // No account readable means no balance was checked at all.
  if (out.accounts.every((a) => a.status === 'no_access')) out.ok = false
  return out
}

async function checkAccount(account: AdAccount, prev: Stored | undefined, dryRun: boolean, call: CallOpts): Promise<FundsAccountResult> {
  const act = `act_${account.id}`
  const info = await graphGet<Info>(act, { fields: 'currency,account_status,is_prepay_account,spend_cap,amount_spent' }, call)
  if (info.currency !== 'INR') throw new Error(`${account.name}: currency is ${info.currency}, not INR`)
  const { today } = istNow(new Date())
  // One row per day with spend: the 7 complete days before today for the runway average, today's row as evidence it is live.
  const days = await graphGetAll<{ spend?: string; date_start?: string }>(`${act}/insights`, {
    level: 'account', fields: 'spend', time_increment: 1, time_range: JSON.stringify({ since: addDays(today, -7), until: today }),
  }, call)
  const spendOn = (pick: (date: string) => boolean) => days.filter((r) => pick(r.date_start ?? '')).reduce((s, r) => s + toPaise(r.spend), 0)
  const active = await graphGetAll<{ id: string }>(`${act}/campaigns`, { fields: 'id', effective_status: JSON.stringify(['ACTIVE']), limit: 50 }, call)

  const row: FundsRow = {
    account_id: account.id, store_id: account.storeId, name: account.name, account_status: info.account_status ?? 0, is_prepay: info.is_prepay_account === true,
    // spend_cap and amount_spent come in paise already (minor units); insights spend comes in rupees.
    spend_cap_paise: Math.round(Number(info.spend_cap ?? 0)), amount_spent_paise: Math.round(Number(info.amount_spent ?? 0)),
    daily_spend_paise: Math.round(spendOn((date) => date < today) / 7), today_spend_paise: Math.round(spendOn((date) => date === today)),
    active_campaigns: active.length > 0, checked_at: new Date().toISOString(),
  }
  const cur = mapFundsRow(row)
  const prevLevel = prev?.alert_level ?? 'ok'
  const prevRemaining = prev ? mapFundsRow(prev).remaining : null
  const { store, push } = alertFor(prevLevel, cur, prevRemaining, prev?.pending_push ?? null)
  const result: FundsAccountResult = {
    account: account.id, name: account.name, status: 'ok', level: cur.level, watched: cur.watched, remaining: cur.remaining, runway_days: cur.runwayDays, pushed: push,
  }
  if (dryRun) return result

  let kept = store
  let alertedAt: string | undefined
  let pending: FundsLevel | null = null
  if (push !== null) {
    const { title, body } = fundsMessage(cur, push)
    try {
      // Past the deadline there may be no time to save the result: leave the push pending for the next run instead.
      if (call.deadlineAt !== undefined && Date.now() >= call.deadlineAt) throw new Error('out of time')
      await notify({ title, body, priority: push === 'out' ? 4 : push === 'low' ? 3 : 2, tags: [push === 'ok' ? 'white_check_mark' : 'warning'] }, PUSH_TIMEOUT_MS)
      alertedAt = row.checked_at
    } catch (e) {
      // Not sent: keep the old level and the push pending, so the next run tries again.
      kept = prevLevel
      pending = push
      result.pushed = null
      result.error = `push failed: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  const { error, status } = await supabase().from('cc_ad_account_funds').upsert(
    { ...row, alert_level: kept, pending_push: pending, ...(alertedAt ? { alerted_at: alertedAt } : {}) },
    { onConflict: 'account_id' },
  )
  if (error) throw dbError('cc_ad_account_funds', error, status)
  return result
}
