import { AlertTriangle, ChevronRight, CircleCheck, Clock } from 'lucide-react'
import type { capitalSummary } from '@/lib/capital'
import type { Forecast } from '@/lib/forecast'
import type { GstMonth, GstResult } from '@/lib/gst'
import { inr } from '@/lib/metrics'
import { ForecastChart } from './ForecastChart'

/** To the paisa: the portal asks for exact figures. */
const exact = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const rs = (paise: number) => inr(paise / 100)
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
export const shortMonth = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' })
const daysFrom = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

/** A one-line-tall box that centres an icon on the first line of the text beside it. */
const ICON = 'flex h-lh shrink-0 items-center'

const HERO = 'text-[2.1rem] font-extrabold leading-none tracking-[-0.03em] tabular-nums'

/** A return's due date: plain when far off, amber within 3 days, red when late. The state is always in words. */
function Due({ gstr, on, today }: { gstr: '1' | '3B'; on: string; today: string }) {
  const left = daysFrom(today, on)
  const state = left < 0 ? ` · ${-left} ${-left === 1 ? 'day' : 'days'} late` : left === 0 ? ' · today' : left <= 3 ? ` · in ${left} ${left === 1 ? 'day' : 'days'}` : ''
  const tone = left < 0 ? 'bg-bad/12 text-bad ring-bad/45' : left <= 3 ? 'bg-warn/10 text-warn ring-warn/40' : 'text-ink-2 ring-line-strong'
  const Icon = left < 0 ? AlertTriangle : left <= 3 ? Clock : null
  return (
    <span className={`inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-semibold ring-1 ${tone}`}>
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      <span><span className="@max-sm:hidden">GSTR-</span>{gstr} · {day(on)}{state}</span>
    </span>
  )
}

function MonthBlock({ m, today }: { m: GstMonth; today: string }) {
  const itcParts = [
    ['vFulfill', m.itc.vfulfill], ['Meta ads', m.itc.meta], ['checkout', m.itc.checkout], ['gateways', m.itc.gateway],
    ['RCM claimed back', m.itc.rcm], ['entered by hand', m.itc.manual],
  ].filter(([, v]) => v !== 0).map(([k, v]) => `${k} ${exact(v as number)}`)
  const rows: { label: string; note: string; value: string; plain?: boolean }[] = [
    {
      label: 'Output tax',
      note: m.output.orders === 0 && m.output.manual === 0
        ? 'No delivered orders in the shipments export for this month'
        : `${m.output.orders} delivered ${m.output.orders === 1 ? 'order' : 'orders'}: IGST ${exact(m.output.igst)} · CGST ${exact(m.output.cgst)} · SGST ${exact(m.output.sgst)}${m.output.manual ? ` · entered ${exact(m.output.manual)}` : ''}`,
      value: exact(m.output.total),
    },
    { label: 'Input credit (estimate)', note: itcParts.length ? itcParts.join(' · ') : 'None yet', value: exact(m.itc.total) },
    { label: 'Credit ledger', note: `${exact(m.opening)} at the start, ${exact(m.closing)} left after this return`, value: m.payable > 0 ? `${exact(m.payable)} short` : 'Covers it', plain: m.payable <= 0 },
    { label: 'RCM, paid in cash', note: 'Fixed costs billed from abroad (Shopify, Claude, ChatGPT) and RCM entries: 18% IGST, claimed back as credit the same month', value: exact(m.rcm) },
  ]
  return (
    <div className="glass-row px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h3 className="font-bold text-ink">{monthName(m.month)}{m.partial ? <span className="ml-2 text-xs font-normal text-ink-3">so far</span> : null}</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <Due gstr="1" on={m.gstr1Due} today={today} />
          <Due gstr="3B" on={m.gstr3bDue} today={today} />
        </div>
      </div>
      <p className="mt-2 text-sm text-ink-2">Cash with the GSTR-3B</p>
      <p className="text-[1.3rem] font-bold tabular-nums text-ink">{exact(m.cash)}</p>
      {m.cash > m.rcm ? <p className="text-xs text-ink-3">RCM {exact(m.rcm)} + tax {exact(m.payable)}</p> : null}
      <dl className="mt-2 divide-y divide-line">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-x-6 py-2">
            <dt className="min-w-0 flex-1 text-sm text-ink-2">{r.label}<span className="block text-xs text-ink-3">{r.note}</span></dt>
            <dd className={`text-sm font-semibold tabular-nums ${r.plain ? 'text-ink-2' : 'text-ink'}`}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * GST for the one GSTIN: every month not filed yet (after the latest credit balance entered on Settings) and the
 * month in progress. Same figures whichever store is picked: GST is never split by store.
 */
export function GstCard({ g, today, vfDaysAgo }: { g: GstResult | null; today: string; vfDaysAgo: number | null }) {
  if (!g) {
    return (
      <section aria-labelledby="gst-h" className="glass rise px-5 py-4">
        <h2 id="gst-h" className="text-lg font-bold">GST</h2>
        <p className="mt-2 text-ink-2">GST reads real data only, or could not be loaded: see the server log.</p>
      </section>
    )
  }
  const unfiled = g.months.filter((m) => !m.partial)
  const next = g.months[0]
  return (
    <section aria-labelledby="gst-h" className="glass rise @container h-full p-2">
      <div className="px-3">
        <div className="flex flex-wrap items-baseline gap-x-3 pt-2">
          <h2 id="gst-h" className="text-lg font-bold">GST</h2>
          <span className="text-sm text-ink-3">One GSTIN · all stores · estimate</span>
        </div>
        {next ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div>
              <p className={`${HERO} ${next.cash === 0 ? 'text-ink-2' : 'text-ink'}`}>{rs(next.cash)}</p>
              <p className="mt-1 text-sm text-ink-2">{next.partial ? `so far for ${monthName(next.month)}` : `due with ${monthName(next.month)}'s GSTR-3B`}</p>
            </div>
            <Due gstr="3B" on={next.gstr3bDue} today={today} />
          </div>
        ) : null}
        <div className="mt-2 space-y-1 text-sm">
          <p className="text-ink-2">
            {g.seed ? <>Filed through {monthName(g.seed.month)}, {exact(g.seed.balancePaise)} credit left</> : <>No credit balance entered on Settings: the ledger starts at ₹0.</>}
          </p>
          {unfiled.length > 0 ? (
            <p className="flex items-start gap-2 text-warn"><span className={ICON}><AlertTriangle className="size-4" aria-hidden /></span><span>{unfiled.length} past {unfiled.length === 1 ? 'month' : 'months'} not marked filed</span></p>
          ) : null}
          {vfDaysAgo === null || vfDaysAgo > 3 ? (
            <p className="flex items-start gap-2 text-warn"><span className={ICON}><AlertTriangle className="size-4" aria-hidden /></span><span>Output tax counts delivered orders from the vFulfill shipments export, last imported {vfDaysAgo === null ? 'never' : `${vfDaysAgo} days ago`}: orders delivered since are missing.</span></p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        {g.months.map((m) => <MonthBlock key={m.month} m={m} today={today} />)}
      </div>
      <p className="mt-3 px-3 pb-2 text-xs text-ink-3">Estimate: the GSTR-2B decides the credit, and vFulfill and Meta invoices often reach it a month late. Late fees and interest not included.</p>
    </section>
  )
}

type Capital = ReturnType<typeof capitalSummary>

/** What VXP owes: loans with interest and due dates, then the partners' capital. */
export function CapitalCard({ c }: { c: Capital | null }) {
  if (!c) return null
  const open = c.loans.filter((l) => !l.settled)
  const row = 'glass-row flex items-baseline justify-between gap-x-6 px-3 py-3'
  return (
    <section aria-labelledby="capital-h" className="glass rise h-full p-2">
      <div className="flex flex-wrap items-baseline gap-x-3 px-3 pt-2">
        <h2 id="capital-h" className="text-lg font-bold">Capital &amp; loans</h2>
        <span className="text-sm text-ink-3">All VXP</span>
      </div>
      {c.loans.length === 0 && c.partners.length === 0 ? <p className="mt-3 px-3 pb-2 text-ink-2">Nothing entered yet: add loans and partner capital on Settings.</p> : (
        <>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-3 px-3">
            <span className={`${HERO} ${c.loanTotalDue === 0 ? 'text-ink-2' : 'text-ink'}`}>{rs(c.loanTotalDue)}</span>
            <span className="text-sm text-ink-2">owed on {open.length} {open.length === 1 ? 'loan' : 'loans'}</span>
          </p>
          {c.loans.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {c.loans.map((l) => (
                <li key={l.id} className={row}>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{l.name}</p>
                    <p className="text-xs text-ink-3">
                      {rs(l.amountPaise)} on {day(l.receivedOn)}{l.repaidPaise ? `, ${rs(l.repaidPaise)} repaid` : ''}
                      {l.interestRate ? ` · ${+(l.interestRate * 100).toFixed(2)}% a year: ${rs(l.interest)} interest so far` : ' · no interest'}
                    </p>
                    {l.settled ? <p className="mt-0.5 flex items-start gap-2 text-xs text-good"><span className={ICON}><CircleCheck className="size-4" aria-hidden /></span>Repaid in full</p>
                      : l.daysOverdue !== null ? <p className="mt-0.5 flex items-start gap-2 text-xs font-semibold text-bad"><span className={ICON}><AlertTriangle className="size-4" aria-hidden /></span><span>Was due {day(l.dueOn!)}: <span className="whitespace-nowrap">{l.daysOverdue} days overdue</span></span></p>
                        : l.dueOn ? <p className="mt-0.5 text-xs text-ink-3">Due {day(l.dueOn)}</p> : null}
                  </div>
                  <span className="text-[1.3rem] font-bold tabular-nums text-ink">{rs(l.totalDue)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {c.partners.length > 0 ? (
            <>
              <p className="label mt-4 px-3">Partner capital</p>
              <ul className="mt-2 space-y-1.5">
                {c.partners.map((p) => (
                  <li key={p.name} className={row}>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">{p.name}</p>
                      <p className="text-xs text-ink-3">{p.entries.length} {p.entries.length === 1 ? 'entry' : 'entries'}{p.repaid ? `, ${rs(p.repaid)} returned` : ''}</p>
                    </div>
                    <span className="text-[1.3rem] font-bold tabular-nums text-ink">{rs(p.outstanding)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <div className="pb-2" />
        </>
      )}
    </section>
  )
}

const signed = (paise: number) => `${paise < 0 ? '−' : paise > 0 ? '+' : ''}${inr(Math.abs(paise) / 100)}`

/**
 * Running total of net profit from Day 1 (opening result + every P&L month), and what it takes to clear a loss.
 * Follows the store switch, like the P&L table above it.
 */
export function ForecastCard({ f, scope }: { f: Forecast | null; scope: string }) {
  if (!f) return null
  const tone = (p: number) => (p < 0 ? 'text-bad' : p > 0 ? 'text-good' : 'text-ink')
  return (
    <section id="forecast" aria-labelledby="forecast-h" className="glass rise @container scroll-mt-16 p-5">
      <h2 id="forecast-h" className="text-lg font-bold">Forecast · {scope}</h2>
      <p className={`mt-3 ${HERO} ${tone(f.cumulative)}`}>{signed(f.cumulative)}</p>
      <p className="mt-1.5 text-sm font-semibold text-ink-2">Running total from <span className="whitespace-nowrap">Day 1</span></p>
      <p className="mt-1 max-w-[80ch] text-sm text-ink-2">
        {f.opening.periodEnd ? <>Opens at {signed(f.opening.netPaise)} up to {day(f.opening.periodEnd)} (old Cash OS, before GST), then </> : <>From </>}
        every month of the P&amp;L above{f.rows.some((r) => r.partial) ? ', this month as it stands so far' : ''}. Net profit, ex-GST.
      </p>
      <div className="mt-4">
        <div>
          <p className="label">Average finished month</p>
          {f.average === null ? <p className="mt-1 text-ink-2">No finished month yet.</p> : (
            <p className="mt-1"><span className={`text-xl font-extrabold tracking-tight ${tone(f.average)}`}>{signed(f.average)}</span><span className="ml-2 text-sm text-ink-3">over {f.finishedMonths} {f.finishedMonths === 1 ? 'month' : 'months'}</span></p>
          )}
          {f.breakEven ? <p className="mt-2 text-sm text-good">At that pace the loss is cleared by <span className="whitespace-nowrap">{monthName(f.breakEven)}</span>.</p>
            : f.cumulative >= 0 || f.average === null ? null
              : f.average > 0 ? <p className="mt-2 text-sm text-ink-3">At that pace it takes more than 10 years to clear the loss.</p>
                : f.average === 0 ? <p className="mt-2 text-sm text-ink-3">At that pace the loss stays where it is: no break-even date until the average turns positive.</p>
                  : <p className="mt-2 text-sm text-ink-3">At that pace the loss grows: no break-even date until the average turns positive.</p>}
        </div>
      </div>
      <ForecastChart forecast={f} />
      <details className="group mt-4">
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="flex size-4 shrink-0 items-center justify-center"><ChevronRight className="size-4 transition-transform group-open:[transform:rotate(90deg)]" /></span>
          Monthly breakdown · {f.rows.length + (f.opening.periodEnd ? 1 : 0)} months
        </summary>
        <table className="mt-2 w-full text-left text-sm tabular-nums">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="label py-2 font-normal">Month</th>
              <th scope="col" className="label py-2 text-right font-normal">Net profit</th>
              <th scope="col" className="label py-2 text-right font-normal"><span className="hidden @md:inline">Running total</span><span className="@md:hidden">Total</span></th>
            </tr>
          </thead>
          <tbody>
            {f.opening.periodEnd ? (
              <tr className="border-b border-line">
                <th scope="row" className="py-2 font-normal text-ink-2">Up to {day(f.opening.periodEnd)}</th>
                <td className={`py-2 text-right ${tone(f.opening.netPaise)}`}>{signed(f.opening.netPaise)}</td>
                <td className={`py-2 text-right font-semibold ${tone(f.opening.netPaise)}`}>{signed(f.opening.netPaise)}</td>
              </tr>
            ) : null}
            {f.rows.map((r) => (
              <tr key={r.month} className="border-b border-line last:border-0">
                <th scope="row" className="py-2 font-normal text-ink-2"><span className="hidden @md:inline">{monthName(r.month)}{r.partial ? ' (so far)' : ''}</span><span className="@md:hidden">{shortMonth(r.month)}{r.partial ? ' · so far' : ''}</span></th>
                <td className={`py-2 text-right ${tone(r.net)}`}>{signed(r.net)}</td>
                <td className={`py-2 text-right font-semibold ${tone(r.cumulative)}`}>{signed(r.cumulative)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  )
}
