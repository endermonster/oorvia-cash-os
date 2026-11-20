import { metaStoreIds } from './accounts'
import { syncMeta, type MetaResult } from './sync'

/** Meta work stops here (ms after arrival), leaving time to record each run and answer. Routes set maxDuration = 60. */
const DEADLINE_MS = 50_000
const REQUEST_TIMEOUT_MS = 20_000
/** Outlives the function (60 s): a run the platform kills frees its store's lock within 2 minutes. */
const LOCK_TTL_MS = 120_000

type StoreOutcome = { store: string; ok: boolean; error?: string; result?: MetaResult }

/**
 * Syncs every store's Meta spend, default window (the last 7 days plus today, and hourly rows for today and
 * yesterday), under one shared 50 s budget. Shared by the "Sync now" button and the daily cron; callers authenticate.
 *
 * Answers 200 with a per-store summary (a store with no readable account, or an account in the wrong currency or
 * time zone, is `ok: false` with its reasons in `result.skipped`), or 500 if a store's sync threw (network, missing
 * or bad token, database, or a sync of that store already running); the other stores still ran.
 */
export async function syncAllStores(): Promise<Response> {
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
