import { describe, expect, it } from 'vitest'
import { alertFor, fundsFresh, fundsLevel, fundsMessage, fundsWatched, mapFundsRow, type FundsRow } from './funds-level'

const row = (over: Partial<FundsRow> = {}): FundsRow => ({
  account_id: '1338726490985485', store_id: 'oorvia', name: 'Oorvia-1', account_status: 1, is_prepay: true,
  spend_cap_paise: 1_000_000, amount_spent_paise: 400_000, daily_spend_paise: 100_000, today_spend_paise: 0, active_campaigns: true, checked_at: '2026-11-24T06:00:00Z', ...over,
})

describe('ad account funds', () => {
  it('reads remaining as spend cap minus amount spent, and runway at the 7-day average', () => {
    expect(mapFundsRow(row())).toMatchObject({ remaining: 6000, dailySpend: 1000, runwayDays: 6, level: 'ok', watched: true })
  })

  it('is low under ₹1,000 left whatever the runway, and out at ₹0 left (Oorvia-1, 2026-11-24: cap = spent)', () => {
    expect(mapFundsRow(row({ amount_spent_paise: 900_100 }))).toMatchObject({ remaining: 999, level: 'low' })
    expect(mapFundsRow(row({ amount_spent_paise: 900_000 }))).toMatchObject({ remaining: 1000, level: 'ok' })
    expect(mapFundsRow(row({ amount_spent_paise: 800_000 }))).toMatchObject({ remaining: 2000, runwayDays: 2, level: 'ok' })
    expect(mapFundsRow(row({ spend_cap_paise: 37_791_363, amount_spent_paise: 37_791_363 }))).toMatchObject({ remaining: 0, level: 'out' })
  })

  it('is out when the account status stops delivery, low when Meta still runs the ads (pending settlement, grace period)', () => {
    for (const s of [2, 3, 7, 100, 101]) expect(fundsLevel({ accountStatus: s, remaining: 6000, dailySpend: 1000, active: true })).toBe('out')
    for (const s of [8, 9]) expect(fundsLevel({ accountStatus: s, remaining: 6000, dailySpend: 1000, active: true })).toBe('low')
    expect(fundsLevel({ accountStatus: 9, remaining: 0, dailySpend: 1000, active: true })).toBe('out')
    expect(fundsMessage({ name: 'Kaiven', prepay: true, accountStatus: 9, remaining: 6000, runwayDays: 6 }, 'low'))
      .toEqual({ title: 'Kaiven ad account in its grace period', body: 'Ads still run, but Meta stops them if billing is not settled. Settle it in Billing soon.' })
  })

  it('never alerts on an account with no cap (Oorvia-2); watches an ACTIVE campaign even before it spends', () => {
    expect(mapFundsRow(row({ spend_cap_paise: 0, amount_spent_paise: 0 }))).toMatchObject({ remaining: null, runwayDays: null, level: 'ok' })
    expect(mapFundsRow(row({ daily_spend_paise: 0, amount_spent_paise: 999_000 }))).toMatchObject({ remaining: 10, runwayDays: null, level: 'low', watched: true })
    expect(mapFundsRow(row({ daily_spend_paise: 0, amount_spent_paise: 999_000, active_campaigns: false }))).toMatchObject({ level: 'low', watched: false })
  })

  it('watches accounts with an ACTIVE campaign; a billing problem without one needs recent spend', () => {
    const r = { accountStatus: 1, remaining: 100, dailySpend: 1000, todaySpend: 0, active: false }
    expect(fundsWatched(r)).toBe(false)
    expect(fundsWatched({ ...r, accountStatus: 3 })).toBe(true)
    expect(fundsWatched({ ...r, accountStatus: 3, dailySpend: 0 })).toBe(false)
  })

  it('watches an account that spent only today: resumed after a quiet week and ran dry the same day', () => {
    const cur = mapFundsRow(row({ daily_spend_paise: 0, today_spend_paise: 250_000, amount_spent_paise: 1_000_000 }))
    expect(cur).toMatchObject({ level: 'out', watched: true, todaySpend: 2500, runwayDays: null })
    expect(alertFor('ok', cur, 6000)).toEqual({ store: 'out', push: 'out' })
  })

  it('is fresh for 6 hours after the read', () => {
    const now = new Date('2026-11-24T12:00:00Z')
    expect(fundsFresh('2026-11-24T06:00:00Z', now)).toBe(true)
    expect(fundsFresh('2026-11-24T05:59:00Z', now)).toBe(false)
  })

  it('words the push and the call', () => {
    const a = { name: 'Oorvia-1', prepay: true, accountStatus: 1, remaining: 2424.16, runwayDays: 1.6 }
    expect(fundsMessage(a, 'low')).toEqual({ title: 'Oorvia-1 low on funds', body: '₹2,424 left, about 1 day at current spend. Add funds.' })
    expect(fundsMessage({ ...a, runwayDays: 0.4 }, 'low').body).toBe('₹2,424 left, less than a day at current spend. Add funds.')
    expect(fundsMessage({ ...a, remaining: 999.75, runwayDays: null }, 'low').body).toBe('₹999 left. Add funds.')
    expect(fundsMessage({ ...a, remaining: 0 }, 'out')).toEqual({ title: 'Oorvia-1 out of funds', body: '₹0 left: Meta has stopped its ads. Add funds.' })
    expect(fundsMessage({ ...a, accountStatus: 3 }, 'out').title).toBe('Oorvia-1 ad account unsettled')
    expect(fundsMessage({ ...a, runwayDays: 12.5 }, 'ok')).toEqual({ title: 'Oorvia-1 funds OK', body: '₹2,424 left, about 12 days at current spend.' })
  })

  it('tells a card-funded account to raise its spending limit, not add funds', () => {
    const a = { name: 'Oorvia-2', prepay: false, accountStatus: 1, remaining: 2424.16, runwayDays: 1.6 }
    expect(fundsMessage(a, 'low')).toEqual({ title: 'Oorvia-2 near its spending limit', body: '₹2,424 left before the spending limit, about 1 day at current spend. Raise the limit in Billing.' })
    expect(fundsMessage({ ...a, remaining: 0 }, 'out')).toEqual({ title: 'Oorvia-2 hit its spending limit', body: 'Meta has stopped its ads. Raise or reset the limit in Billing.' })
    expect(fundsMessage({ ...a, accountStatus: 3 }, 'out').title).toBe('Oorvia-2 ad account unsettled')
    expect(mapFundsRow(row({ is_prepay: false })).prepay).toBe(false)
  })
})

describe('alertFor', () => {
  const watched = (level: 'ok' | 'low' | 'out', remaining: number | null = 100) => ({ level, watched: true, remaining })
  const quiet = (level: 'ok' | 'low' | 'out', remaining: number | null = 100) => ({ level, watched: false, remaining })

  it('pushes once per change on a watched account, never a repeat', () => {
    expect(alertFor('ok', watched('low'), 5000)).toEqual({ store: 'low', push: 'low' })
    expect(alertFor('low', watched('low'), 5000)).toEqual({ store: 'low', push: null })
    expect(alertFor('low', watched('out', 0), 100)).toEqual({ store: 'out', push: 'out' })
    expect(alertFor('out', watched('ok', 9000), 0)).toEqual({ store: 'ok', push: 'ok' })
  })

  it('never pushes low or out for an unwatched account, and keeps the old level', () => {
    expect(alertFor('ok', quiet('low'), 5000)).toEqual({ store: 'ok', push: null })
    expect(alertFor('low', quiet('out', 0), 100)).toEqual({ store: 'low', push: null })
  })

  it('resets an unwatched account to ok quietly, pushing "funds OK" only after a top-up', () => {
    expect(alertFor('low', quiet('ok', 100), 100)).toEqual({ store: 'ok', push: null })
    expect(alertFor('out', quiet('ok', 9000), 0)).toEqual({ store: 'ok', push: 'ok' })
  })

  it('retries a failed push while the account is still at that level, then drops it', () => {
    // The "funds OK" after a top-up failed; the new balance is now the baseline, so only `pending` remembers it.
    expect(alertFor('out', quiet('ok', 9000), 9000, 'ok')).toEqual({ store: 'ok', push: 'ok' })
    expect(alertFor('ok', watched('ok'), 100, 'low')).toEqual({ store: 'ok', push: null })
    expect(alertFor('ok', watched('low'), 5000, 'low')).toEqual({ store: 'low', push: 'low' })
  })

  it('drops a pending low or out once the account is no longer watched (he paused every campaign)', () => {
    expect(alertFor('ok', quiet('out', 0), 0, 'out')).toEqual({ store: 'ok', push: null })
    expect(alertFor('ok', quiet('low'), 5000, 'low')).toEqual({ store: 'ok', push: null })
  })
})
