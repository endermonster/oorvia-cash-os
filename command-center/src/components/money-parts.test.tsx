import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { capitalSummary, type CapitalRow } from '@/lib/capital'
import type { GstMonth, GstResult } from '@/lib/gst'
import type { Forecast } from '@/lib/forecast'
import { CapitalCard, ForecastCard, GstCard } from './MoneyParts'

const month: GstMonth = {
  month: '2026-10',
  output: { igst: 0, cgst: 0, sgst: 0, manual: 0, total: 0, orders: 0 },
  itc: { vfulfill: 0, meta: 0, checkout: 0, gateway: 0, rcm: 0, manual: 0, total: 0 },
  rcm: 0, opening: 0, payable: 0, closing: 0, cash: 0,
  gstr1Due: '2030-01-11', gstr3bDue: '2026-11-20', partial: false,
}

/** The GSTR-3B chip(s): the card renders it in the header and in the month block. */
function chips(today: string, gstr3bDue: string, gstr1Due = '2030-01-11') {
  const g: GstResult = { seed: null, months: [{ ...month, gstr1Due, gstr3bDue }] }
  const html = renderToStaticMarkup(<GstCard g={g} today={today} vf={{ stale: false, short: 'today', phrase: 'was last imported today' }} />).replace(/<!-- -->/g, '')
  return (html.match(/<span class="inline-flex[^"]*">.*?<\/span><\/span>/g) ?? []).filter((c) => c.includes('3B'))
}

describe('GstCard due-date chips', () => {
  it('4 days away: plain, no state words', () => {
    const c = chips('2026-11-16', '2026-11-20')
    expect(c.length).toBeGreaterThan(0)
    for (const x of c) {
      expect(x).toContain('text-ink-2')
      expect(x).not.toContain('text-warn')
      expect(x).not.toContain('text-bad')
      expect(x).not.toMatch(/ in \d| today| late/)
    }
  })

  it('3 days away: amber, "in 3 days"', () => {
    for (const x of chips('2026-11-17', '2026-11-20')) {
      expect(x).toContain('bg-warn/10 text-warn')
      expect(x).toContain('in 3 days')
    }
  })

  it('1 day away: amber, singular "in 1 day"', () => {
    for (const x of chips('2026-11-19', '2026-11-20')) expect(x).toContain('in 1 day<')
  })

  it('due today: amber, "today"', () => {
    const c = chips('2026-11-20', '2026-11-20')
    expect(c.length).toBeGreaterThan(0)
    for (const x of c) {
      expect(x).toContain('text-warn')
      expect(x).toContain('· today')
    }
  })

  it('1 day late: red, "1 day late"', () => {
    const c = chips('2026-11-21', '2026-11-20')
    expect(c.length).toBeGreaterThan(0)
    for (const x of c) {
      expect(x).toContain('bg-bad/12 text-bad')
      expect(x).not.toContain('text-warn')
      expect(x).toContain('1 day late')
    }
  })

  it('5 days late: red, plural', () => {
    for (const x of chips('2026-11-25', '2026-11-20')) expect(x).toContain('5 days late')
  })
})

const loan = (o: Partial<CapitalRow>): CapitalRow => ({
  id: 1, kind: 'loan', name: 'Loan A', amountPaise: 1_000_000, receivedOn: '2026-08-01',
  interestRate: 0.18, dueOn: null, repaidPaise: 0, note: null, ...o,
})

describe('CapitalCard', () => {
  const today = '2026-11-20'
  const render = (rows: CapitalRow[]) => renderToStaticMarkup(<CapitalCard c={capitalSummary(rows, today)} />).replace(/<!-- -->/g, '')

  it('is labelled All VXP', () => {
    expect(render([loan({})])).toContain('All VXP')
  })

  it('overdue loan: red line with the day count', () => {
    const html = render([loan({ dueOn: '2026-11-10' })])
    expect(html).toMatch(/text-bad[^>]*>.*10 days overdue/)
    expect(html).toContain('Was due 10 Nov')
    expect(html).not.toContain('Repaid in full')
  })

  it('fully repaid loan: "Repaid in full", not overdue', () => {
    const html = render([loan({ dueOn: '2026-11-10', repaidPaise: 1_000_000 })])
    expect(html).toContain('Repaid in full')
    expect(html).not.toContain('overdue')
    expect(html).toContain('owed on 0 loans')
  })

  it('partner capital rows render with entries and returned amounts', () => {
    const html = render([
      { ...loan({ id: 2 }), kind: 'partner', name: 'Asha', amountPaise: 500_000, interestRate: null, repaidPaise: 100_000 },
      { ...loan({ id: 3 }), kind: 'partner', name: 'Asha', amountPaise: 200_000, interestRate: null },
      { ...loan({ id: 4 }), kind: 'partner', name: 'Ravi', amountPaise: 300_000, interestRate: null },
    ])
    expect(html).toContain('Partner capital')
    expect(html).toContain('Asha')
    expect(html).toContain('2 entries')
    expect(html).toContain('returned')
    expect(html).toContain('Ravi')
    expect(html).toContain('1 entry')
  })
})

describe('ForecastCard', () => {
  const f: Forecast = {
    opening: { netPaise: -100, periodEnd: '2026-09-30', note: null },
    rows: [{ month: '2026-10', net: -200, cumulative: -300, partial: false }],
    cumulative: -300, average: -200, finishedMonths: 1,
    needed: [{ months: 6, perMonth: 50 }], breakEven: null,
  }

  it('drops the clearing rows and puts the month table in a closed details', () => {
    const html = renderToStaticMarkup(<ForecastCard f={f} scope="All VXP" />).replace(/<!-- -->/g, '')
    expect(html).not.toContain('To clear it in')
    expect(html).not.toContain('needed a month')
    const d = html.match(/<details(?![^>]*\sopen)[^>]*>[\s\S]*<\/details>/)?.[0] ?? ''
    expect(d).toContain('Monthly breakdown · 2 months')
    expect(d).toContain('<table')
    expect(html.indexOf('<table')).toBe(html.indexOf('<table', html.indexOf('<details')))
  })
})
