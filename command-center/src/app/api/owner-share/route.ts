import { bearerMatches } from '@/lib/auth/bearer'
import { istNow } from '@/lib/dates'
import { SHARE_MONTHS, shareSummary } from '@/lib/owner-share'
import { addMonths } from '@/lib/pnl'
import { loadPnl } from '@/lib/pnl-load'

export const maxDuration = 30

/**
 * Vedaant's monthly share of VXP net profit, read server-side by the personal finance app
 * (finance.vxpventures.com), which sends `Authorization: Bearer $OWNER_SHARE_SECRET`. Read-only.
 * Exempt from the login gate (MACHINE_PATHS in src/lib/auth/gate.ts), so this check is its only lock. It fails
 * closed: with OWNER_SHARE_SECRET unset, nothing gets in.
 */
export async function GET(request: Request) {
  if (!bearerMatches(request.headers.get('authorization'), process.env.OWNER_SHARE_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const now = new Date()
  const today = istNow(now).today
  const month = today.slice(0, 7)
  try {
    const pnl = await loadPnl(addMonths(month, -(SHARE_MONTHS - 1)), month, today)
    return Response.json(shareSummary(pnl, month, now.toISOString()), { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    console.error(`owner-share: ${e instanceof Error ? e.message : String(e)}`)
    return Response.json({ error: 'The P&L could not be loaded' }, { status: 500 })
  }
}
