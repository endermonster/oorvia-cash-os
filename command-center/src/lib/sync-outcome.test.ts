import { describe, expect, it } from 'vitest'
import { summarize, type StoreOutcome } from './sync-outcome'

const acct = (name: string, account: string, status: string) => ({ name, account, status })
const store = (id: string, ok: boolean, accounts: ReturnType<typeof acct>[], skipped: string[] = []): StoreOutcome => ({ store: id, ok, result: { accounts, skipped } })

describe('summarize', () => {
  it('fails when the server gave no readable answer', () => {
    expect(summarize(null)).toEqual({ alert: 'Sync failed', note: null })
    expect(summarize({ ok: false })).toEqual({ alert: 'Sync failed', note: null })
  })

  it('says nothing when every store synced', () => {
    expect(summarize({ ok: true, stores: [store('oorvia', true, [acct('Oorvia-1', '1', 'ok')])] })).toEqual({ alert: null, note: null })
  })

  it('stays quiet about a store that synced with one account not yet shared', () => {
    const s = store('oorvia', true, [acct('Oorvia-1', '1', 'ok'), acct('Oorvia-2', '2', 'no_access')], ['Oorvia-2 (2): no access'])
    expect(summarize({ ok: true, stores: [s] })).toEqual({ alert: null, note: null })
  })

  it('warns about a data report from a store that synced, skipping its unshared accounts', () => {
    const s = store('oorvia', true, [acct('Oorvia-1', '1', 'ok'), acct('Oorvia-2', '2', 'no_access')], [
      'Oorvia-2 (2): no access',
      'Oorvia-1 (1): campaign spend does not match the account total (2026-11-18: account 11.01 vs campaigns 10.00): stale rows were not deleted',
    ])
    expect(summarize({ ok: true, stores: [s] })).toEqual({ alert: expect.stringMatching(/^Oorvia-1 \(1\): campaign spend does not match/), note: null })
  })

  it('warns about a campaign with spend and no product in a store that synced', () => {
    const s = store('kaiven', true, [acct('Kaiven', '3', 'ok')], ['campaign "x" (9) in Kaiven has spend but its ads link to no product page'])
    expect(summarize({ ok: true, stores: [s] }).alert).toMatch(/no product page/)
  })

  it('puts a real failure ahead of a data report', () => {
    const synced = store('kaiven', true, [acct('Kaiven', '3', 'ok')], ['Kaiven (3): an hourly row had no readable hour bucket'])
    const broken: StoreOutcome = { store: 'oorvia', ok: false, error: 'META_ACCESS_TOKEN is not set' }
    expect(summarize({ ok: false, stores: [synced, broken] }).alert).toBe('META_ACCESS_TOKEN is not set')
  })

  it('mutes stores whose only problem is no access', () => {
    const k = store('kaiven', false, [acct('Kaiven', '3', 'no_access')], ['Kaiven (3): no access'])
    const s = store('selnova', false, [acct('Selnova1', '4', 'no_access')], ['Selnova1 (4): no access'])
    expect(summarize({ ok: false, stores: [k, s] })).toEqual({ alert: null, note: 'Kaiven, Selnova: Meta not connected' })
  })

  it('alerts with the failing account message, not an earlier campaign report', () => {
    const o = store('oorvia', false, [acct('Oorvia-1', '1', 'ok'), acct('Oorvia-2', '2', 'wrong_currency')], [
      'campaign "x" (9) in Oorvia-1 has spend but its ads link to no product page', 'Oorvia-2 (2): currency is USD, not INR',
    ])
    expect(summarize({ ok: false, stores: [o] }).alert).toBe('Oorvia-2 (2): currency is USD, not INR')
  })

  it('alerts with a thrown error and still notes the unconnected stores', () => {
    const broken: StoreOutcome = { store: 'oorvia', ok: false, error: 'META_ACCESS_TOKEN is not set' }
    const k = store('kaiven', false, [acct('Kaiven', '3', 'no_access')])
    expect(summarize({ ok: false, stores: [k, broken] })).toEqual({ alert: 'META_ACCESS_TOKEN is not set', note: 'Kaiven: Meta not connected' })
  })
})
