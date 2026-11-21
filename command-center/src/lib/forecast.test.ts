import { describe, expect, it } from 'vitest'
import { computeForecast, type Baseline } from './forecast'
import type { MonthPnl, PnlLine, PnlResult } from './pnl'

const line = (netProfit: number) => ({ netProfit } as PnlLine)
const month = (m: string, vxp: number, oorvia: number, kaiven?: number): MonthPnl => ({
  month: m, vxp: line(vxp), shared: { vfByHead: {}, fixed: {} },
  stores: { oorvia: line(oorvia), ...(kaiven === undefined ? {} : { kaiven: line(kaiven) }) },
})
const pnl = (months: MonthPnl[]): PnlResult => ({ months, warnings: [] })
const BASE: Baseline[] = [{ storeId: 'oorvia', periodEnd: '2026-03-13', netPaise: -14010800, note: 'pre-GST' }]

describe('computeForecast', () => {
  it('runs the total from the opening loss, the month in progress included but not averaged', () => {
    const f = computeForecast(pnl([month('2026-09', -100000, -90000), month('2026-10', -200000, -150000), month('2026-11', -50000, -40000)]), BASE, null, '2026-11')
    expect(f.opening).toEqual({ netPaise: -14010800, periodEnd: '2026-03-13', note: 'pre-GST' })
    expect(f.rows.map((r) => [r.month, r.cumulative, r.partial])).toEqual([['2026-09', -14110800, false], ['2026-10', -14310800, false], ['2026-11', -14360800, true]])
    expect(f.average).toBe(-150000)
    expect(f.finishedMonths).toBe(2)
    expect(f.needed).toEqual([{ months: 6, perMonth: 2393467 }, { months: 12, perMonth: 1196734 }, { months: 24, perMonth: 598367 }])
    expect(f.breakEven).toBeNull() // the average loses money
  })

  it('a store gets only its own opening result and its own months from its live month', () => {
    const f = computeForecast(pnl([month('2026-10', 0, 0), month('2026-11', -50000, -40000, -30000)]), BASE, 'kaiven', '2026-11', '2026-11')
    expect(f.opening.netPaise).toBe(0)
    expect(f.rows).toEqual([{ month: '2026-11', net: -30000, cumulative: -30000, partial: true }])
    expect(f.average).toBeNull()
  })

  it('dates break-even from the average once it is positive; nothing needed once the total is not negative', () => {
    const f = computeForecast(pnl([month('2026-10', 100000, 0), month('2026-11', 0, 0)]), [{ ...BASE[0], netPaise: -350000 }], null, '2026-11')
    expect(f.cumulative).toBe(-250000)
    expect(f.breakEven).toBe('2027-02') // 3 months at ₹1,000
    const g = computeForecast(pnl([month('2026-11', 500000, 0)]), [], null, '2026-11')
    expect([g.needed, g.breakEven]).toEqual([[], null])
    // A positive average too small to clear the loss within 10 years gives no date (the card says so, Codex review).
    const slow = computeForecast(pnl([month('2026-10', 100000, 0), month('2026-11', 0, 0)]), [{ ...BASE[0], netPaise: -13910800 }], null, '2026-11')
    expect([slow.average, slow.breakEven]).toEqual([100000, null])
  })
})
