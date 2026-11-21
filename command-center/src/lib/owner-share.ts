import type { PnlResult } from './pnl'

/** Months the personal finance app gets: the current one and the five before it. */
export const SHARE_MONTHS = 6

export type ShareMonth = {
  month: string
  /** VXP net profit, ex-GST, integer paise. */
  netProfitPaise: number
  /** Vedaant's share of it; null when the stores' shares differ and no single VXP share exists. */
  sharePaise: number | null
  /** The month is not over: bills not yet due and orders not yet resolved are missing. */
  inProgress: boolean
}

export type ShareSummary = { months: ShareMonth[]; asOf: string; warnings: number }

/**
 * Vedaant's share of VXP's monthly net profit, for the personal finance app's Business payback (decided
 * 2026-11-21: shown there only; it never changes what the ledger says he owes). Pure: the route loads the P&L.
 */
export function shareSummary(pnl: PnlResult, currentMonth: string, asOf: string): ShareSummary {
  return {
    months: pnl.months.map((m) => ({
      month: m.month,
      netProfitPaise: m.vxp.netProfit,
      sharePaise: m.vxp.ownerShare,
      inProgress: m.month >= currentMonth,
    })),
    asOf,
    warnings: pnl.warnings.length,
  }
}
