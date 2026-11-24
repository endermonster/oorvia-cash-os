import { bearerMatches } from '@/lib/auth/bearer'
import { invalidateData } from '@/lib/cached'
import { syncAllStores } from '@/lib/meta/run'

/** The platform kills the function at this many seconds. */
export const maxDuration = 60

/**
 * The daily Meta sync, called by Vercel Cron (vercel.json), which sends `Authorization: Bearer $CRON_SECRET`.
 * Exempt from the login gate (MACHINE_PATHS in src/lib/auth/gate.ts), so this check is its only lock. It fails
 * closed: with CRON_SECRET unset, nothing gets in.
 */
export async function GET(request: Request) {
  if (!bearerMatches(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return await syncAllStores()
  } finally {
    invalidateData() // also after a partial failure: the stores that did sync have new numbers
  }
}
