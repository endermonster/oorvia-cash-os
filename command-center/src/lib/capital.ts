/**
 * Capital & loans: money put into VXP by the partners, and loans with what is still owed. Pure, integer paise.
 * Interest is simple, on the full amount from the day it came in to today, as old Cash OS worked it out
 * (`app/api/cash/route.js`): repayments carry no dates, so interest can't be cut as they happen.
 */
export type CapitalRow = {
  id: number
  kind: 'loan' | 'partner'
  name: string
  amountPaise: number
  receivedOn: string
  /** Annual, as a fraction (0.18 = 18%). Loans only. */
  interestRate: number | null
  dueOn: string | null
  repaidPaise: number
  note: string | null
}

export type Loan = CapitalRow & { outstanding: number; days: number; interest: number; totalDue: number; daysOverdue: number | null; settled: boolean }
export type Partner = { name: string; amount: number; repaid: number; outstanding: number; entries: CapitalRow[] }

const DAY = 86_400_000
const daysBetween = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY))

export function capitalSummary(rows: CapitalRow[], today: string) {
  const loans: Loan[] = rows.filter((r) => r.kind === 'loan').map((r) => {
    const outstanding = Math.max(0, r.amountPaise - r.repaidPaise)
    const settled = outstanding === 0
    const days = daysBetween(r.receivedOn, today)
    const interest = settled ? 0 : Math.round((r.amountPaise * (r.interestRate ?? 0) * days) / 365)
    const overdue = !settled && r.dueOn !== null && r.dueOn < today
    return { ...r, outstanding, days, interest, totalDue: outstanding + interest, daysOverdue: overdue ? daysBetween(r.dueOn!, today) : null, settled }
  })
  const byName = new Map<string, Partner>()
  for (const r of rows) {
    if (r.kind !== 'partner') continue
    const p = byName.get(r.name) ?? { name: r.name, amount: 0, repaid: 0, outstanding: 0, entries: [] }
    p.amount += r.amountPaise
    p.repaid += r.repaidPaise
    p.outstanding = Math.max(0, p.amount - p.repaid)
    p.entries.push(r)
    byName.set(r.name, p)
  }
  const partners = [...byName.values()]
  return {
    loans,
    partners,
    loanTotalDue: loans.reduce((s, l) => s + l.totalDue, 0),
    partnerTotal: partners.reduce((s, p) => s + p.outstanding, 0),
  }
}
