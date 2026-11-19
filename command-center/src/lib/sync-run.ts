import 'server-only'
import { dbError } from './db-error'
import { supabase } from './supabase'

/**
 * Writes a cc_sync_runs row around `fn`: started now, finished with ok and a JSON detail. Rethrows after recording.
 * `isOk` lets a run that finished but found a problem (a Meta store with no readable account) be recorded ok:false
 * with its full result as the detail; by default a run that returns is ok.
 */
export async function withRun<T extends object>(
  source: string, storeId: string, fn: () => Promise<T>, isOk: (result: T) => boolean = () => true,
): Promise<T> {
  const sb = supabase()
  // started_at from this clock too, so started and finished are comparable (the DB default is the DB server's clock).
  const { data, error, status } = await sb.from('cc_sync_runs').insert({ source, store_id: storeId, started_at: new Date().toISOString() }).select('id').single()
  if (error) throw dbError('cc_sync_runs', error, status)
  const id = data.id as number
  const finish = (ok: boolean, detail: unknown) => recordFinish(id, { finished_at: new Date().toISOString(), ok, detail: JSON.stringify(detail) })
  let result: T
  try {
    result = await fn()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // The work's own error is what matters: a failure to record it is logged, never thrown in its place.
    await finish(false, { error: message }).catch((r) => console.error(`cc_sync_runs ${id}: could not record the failure: ${r instanceof Error ? r.message : r}`))
    throw e
  }
  // The header's "Synced N min ago" reads this row, so a lost write would show stale freshness: retried, then thrown.
  await finish(isOk(result), result)
  return result
}

/** Updates a cc_sync_runs row, retrying transient errors twice (0.5 s, then 1 s). Throws if it still fails. */
async function recordFinish(id: number, patch: { finished_at: string; ok: boolean; detail: string }): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const { error, status } = await supabase().from('cc_sync_runs').update(patch).eq('id', id)
    if (!error) return
    const e = dbError(`cc_sync_runs ${id}`, error, status)
    if (!e.transient || attempt >= 3) throw e
    await new Promise((r) => setTimeout(r, 500 * attempt))
  }
}
