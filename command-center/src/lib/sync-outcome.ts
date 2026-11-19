/** Reads the answer of POST /api/sync/meta for the "Sync now" button. Pure, so it can be tested. */

export type AccountOutcome = { account?: string; name?: string; status: string }
export type StoreOutcome = { store: string; ok: boolean; error?: string; result?: { skipped: string[]; accounts: AccountOutcome[] } }
export type Outcome = { ok: boolean; stores?: StoreOutcome[] }

const cap = (id: string) => id.charAt(0).toUpperCase() + id.slice(1)

/** A store whose only problem is that its ad account is not shared with the sync user yet: expected, not a failure. */
const onlyNoAccess = (s: StoreOutcome) => !s.error && !!s.result && s.result.accounts.every((a) => a.status === 'ok' || a.status === 'no_access')

/** The reported problem of the first account that is not ok ("Name (id): ..."), else the first reported item. */
function problemOf(s: StoreOutcome): string {
  if (s.error) return s.error
  const bad = s.result?.accounts.find((a) => a.status !== 'ok')
  const own = bad && s.result?.skipped.find((m) => m.startsWith(`${bad.name} (${bad.account})`))
  return own ?? s.result?.skipped[0] ?? 'Sync failed'
}

/**
 * A synced store's first report that needs a person (spend not matching the account total, an unreadable hour, a
 * campaign tied to no product), leaving out the expected messages of its accounts that are not shared yet.
 */
function reportOf(s: StoreOutcome): string | undefined {
  const unshared = (s.result?.accounts ?? []).filter((a) => a.status === 'no_access').map((a) => `${a.name} (${a.account})`)
  return s.result?.skipped.find((m) => !unshared.some((p) => m.startsWith(p)))
}

/**
 * What to show after a sync: a warning for a real failure, else for the first report of a store that synced, and a
 * muted note for stores that are simply not connected.
 */
export function summarize(o: Outcome | null): { alert: string | null; note: string | null } {
  const failed = (o?.stores ?? []).filter((x) => !x.ok)
  const real = failed.find((x) => !onlyNoAccess(x))
  const muted = failed.filter(onlyNoAccess).map((x) => cap(x.store))
  const report = (o?.stores ?? []).filter((x) => x.ok).map(reportOf).find((m) => m !== undefined)
  return {
    alert: real ? problemOf(real) : report ?? (o?.stores ? null : 'Sync failed'),
    note: muted.length > 0 ? `${muted.join(', ')}: Meta not connected` : null,
  }
}
