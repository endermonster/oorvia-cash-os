import { allowedUser } from '@/lib/auth/server'
import { invalidateData } from '@/lib/cached'
import { syncAllStores } from '@/lib/meta/run'

/** The platform kills the function at this many seconds. */
export const maxDuration = 60

/**
 * Meta ad spend sync, run on demand by the "Sync now" button (the daily run is /api/cron/meta).
 *
 * NOT PUBLIC. It spends Meta API quota and writes to the database: proxy.ts gates it, and it checks the session
 * itself too, so a matcher change cannot open it.
 */
export async function POST() {
  if (!(await allowedUser())) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return await syncAllStores()
  } finally {
    invalidateData() // also after a partial failure: the stores that did sync have new numbers
  }
}
