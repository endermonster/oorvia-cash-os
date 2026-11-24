import { bearerMatches } from '@/lib/auth/bearer'
import { invalidateData } from '@/lib/cached'
import { checkFunds } from '@/lib/meta/funds'

/** The platform kills the function at this many seconds. */
export const maxDuration = 60

/**
 * The ad account funds check, every 2 hours (Supabase pg_cron + pg_net), with `Authorization: Bearer $FUNDS_CRON_SECRET`.
 * Exempt from the login gate (MACHINE_PATHS in src/lib/auth/gate.ts), so this check is its only lock. It fails closed:
 * with FUNDS_CRON_SECRET unset, nothing gets in. `?dry=1` reads Meta and answers what it would push, writing nothing.
 */
export async function GET(request: Request) {
  if (!bearerMatches(request.headers.get('authorization'), process.env.FUNDS_CRON_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const dryRun = new URL(request.url).searchParams.get('dry') === '1'
  try {
    // Meta stops at 45 s; at most one 5 s push and the saves follow, inside the 60 s limit.
    const result = await checkFunds({ dryRun, call: { deadlineAt: Date.now() + 45_000, timeoutMs: 15_000 } })
    return Response.json(result, { status: result.ok ? 200 : 500 })
  } catch (e) {
    console.error(`meta funds: ${e instanceof Error ? e.message : String(e)}`)
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  } finally {
    if (!dryRun) invalidateData() // the top bar shows each ad account's funds; balances saved before a failure stay
  }
}
