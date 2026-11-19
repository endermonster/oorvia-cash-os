import { allowedUser } from '@/lib/auth/server'
import { metaStoreIds } from '@/lib/meta/accounts'
import { syncMeta, type MetaResult } from '@/lib/meta/sync'

/** The platform kills the function at this many seconds. */
export const maxDuration = 60
/** Meta work stops here (ms after arrival), leaving time to record each run and answer. */
const DEADLINE_MS = 50_000
const REQUEST_TIMEOUT_MS = 20_000
/** Outlives the function (60 s): a run the platform kills frees its store's lock within 2 minutes. */
const LOCK_TTL_MS = 120_000

type StoreOutcome = { store: string; ok: boolean; error?: string; result?: MetaResult }

/**
 * Meta ad spend sync, run on demand by the "Sync now" button: every store, default window (the last 7 days
 * plus today, and hourly rows for today and yesterday). All Meta calls share one 50 s budget under the 60 s limit.
 *
 * NOT PUBLIC. It spends Meta API quota and writes to the database: proxy.ts gates it, and it checks the session
 * itself too, so a matcher change cannot open it.
 *
 * Answers 200 with a per-store summary (a store with no readable account, or an account in the wrong currency or
 * time zone, is `ok: false` with its reasons in `result.skipped`), or 500 if a store's sync threw (network, missing
 * or bad token, database, or a sync of that store already running); the other stores still ran.
 */
export async function POST() {
  if (!(await allowedUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const deadlineAt = Date.now() + DEADLINE_MS
  const stores: StoreOutcome[] = []
  for (const store of metaStoreIds()) {
    try {
      const result = await syncMeta(store, { deadlineAt, requestTimeoutMs: REQUEST_TIMEOUT_MS, lockTtlMs: LOCK_TTL_MS })
      stores.push({ store, ok: result.ok, result })
    } catch (e) {
      console.error(`meta sync ${store}: ${e instanceof Error ? e.message : String(e)}`)
      stores.push({ store, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
  const threw = stores.some((s) => s.error !== undefined)
  return Response.json({ ok: stores.every((s) => s.ok), stores }, { status: threw ? 500 : 200 })
}
