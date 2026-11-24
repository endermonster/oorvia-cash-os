import 'server-only'
import type { Data } from './data'
import type { GstResult } from './gst'
import { cachedGst, cachedPnl } from './cached'
import type { PnlResult } from './pnl'
import type { GstPosition } from './types'

export function mapGstPosition(gst: GstResult): GstPosition | null {
  const next = gst.months[0]
  return next ? { month: next.month, cash: next.cash / 100, dueDate: next.gstr3bDue, partial: next.partial } : null
}

export function mapOwnerShareMonth(pnl: PnlResult, month: string): Data['ownerShareMonth'] {
  const current = pnl.months.find((m) => m.month === month)
  if (!current) return null
  const { netProfit, ownerShare } = current.vxp
  return { month, net: netProfit / 100, share: ownerShare === null ? null : ownerShare / 100 }
}

async function attempt<T>(what: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run()
  } catch (e) {
    console.error(`home ${what}: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

export async function loadHomeExtras(today: string): Promise<{ gst: GstPosition | null; ownerShareMonth: Data['ownerShareMonth'] }> {
  const month = today.slice(0, 7)
  const [gst, ownerShareMonth] = await Promise.all([
    attempt('gst', async () => mapGstPosition(await cachedGst(today))),
    attempt('pnl', async () => mapOwnerShareMonth(await cachedPnl(month, month, today), month)),
  ])
  return { gst, ownerShareMonth }
}
