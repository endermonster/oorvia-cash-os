/**
 * Forecast: the running total of net profit from Day 1, and what it takes to win it back. Pure, integer paise.
 *
 * Day 1 = each store's opening result before Command Center's months (`cc_pnl_baseline`: Oorvia's pre-GST loss to
 * 13 Mar 2026, carried from old Cash OS), then every monthly P&L net profit, the month in progress included as it
 * stands. Decided 2026-11-22 (Vedaant): while the average month loses money, show the profit needed per month to clear
 * the loss in 6, 12 or 24 months instead of a break-even date; the date appears once the average turns positive.
 */
import { addMonths, type PnlResult } from './pnl'

export type Baseline = { storeId: string; periodEnd: string; netPaise: number; note: string | null }

export type ForecastRow = { month: string; net: number; cumulative: number; partial: boolean }

export type Forecast = {
  /** Opening result before the first month; 0 when there is none. */
  opening: { netPaise: number; periodEnd: string | null; note: string | null }
  rows: ForecastRow[]
  /** Running total now, the month in progress included. */
  cumulative: number
  /** Mean of the finished months; null with none finished yet. */
  average: number | null
  finishedMonths: number
  /** Net profit a month needed to bring the running total to 0 in that many months, from next month. Empty when it is not negative. */
  needed: { months: number; perMonth: number }[]
  /** First month the running total reaches 0 at the average, when the average is positive (within 10 years). */
  breakEven: string | null
}

export const HORIZONS = [6, 12, 24]

/**
 * `store`: one store's line, or null for All VXP (shared costs included, every store's opening result).
 * `firstMonth`: the store's first month (its live month); earlier months of the P&L are left out.
 */
export function computeForecast(pnl: PnlResult, baselines: Baseline[], store: string | null, currentMonth: string, firstMonth?: string): Forecast {
  const open = store === null ? baselines : baselines.filter((b) => b.storeId === store)
  const opening = {
    netPaise: open.reduce((s, b) => s + b.netPaise, 0),
    periodEnd: open.map((b) => b.periodEnd).sort().at(-1) ?? null,
    note: open.length === 1 ? open[0].note : null,
  }
  let cumulative = opening.netPaise
  const rows: ForecastRow[] = []
  for (const m of pnl.months) {
    if (firstMonth && m.month < firstMonth) continue
    if (m.month > currentMonth) break
    const line = store === null ? m.vxp : m.stores[store]
    if (!line) continue
    cumulative += line.netProfit
    rows.push({ month: m.month, net: line.netProfit, cumulative, partial: m.month === currentMonth })
  }
  const finished = rows.filter((r) => !r.partial)
  const average = finished.length ? Math.round(finished.reduce((s, r) => s + r.net, 0) / finished.length) : null
  const needed = cumulative < 0 ? HORIZONS.map((months) => ({ months, perMonth: Math.ceil(-cumulative / months) })) : []
  let breakEven: string | null = null
  if (cumulative < 0 && average !== null && average > 0) {
    const months = Math.ceil(-cumulative / average)
    if (months <= 120) breakEven = addMonths(currentMonth, months)
  }
  return { opening, rows, cumulative, average, finishedMonths: finished.length, needed, breakEven }
}
