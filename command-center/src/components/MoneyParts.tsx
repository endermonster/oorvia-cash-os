import type { capitalSummary } from '@/lib/capital'
import type { Forecast } from '@/lib/forecast'
import type { GstMonth, GstResult } from '@/lib/gst'
import { inr } from '@/lib/metrics'

/** To the paisa: the portal asks for exact figures. */
const exact = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const rs = (paise: number) => inr(paise / 100)
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const daysFrom = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

function Due({ label, on, today }: { label: string; on: string; today: string }) {
  const left = daysFrom(today, on)
  return (
    <span className={left < 0 ? 'font-semibold text-bad' : left <= 3 ? 'font-semibold text-warn' : 'text-ink-2'}>
      {label} {day(on)}{left < 0 ? ` (${-left} ${-left === 1 ? 'day' : 'days'} late)` : left === 0 ? ' (today)' : ''}
    </span>
  )
}

function MonthBlock({ m, today }: { m: GstMonth; today: string }) {
  const itcParts = [
    ['vFulfill', m.itc.vfulfill], ['Meta ads', m.itc.meta], ['checkout', m.itc.checkout], ['gateways', m.itc.gateway],
    ['RCM claimed back', m.itc.rcm], ['entered by hand', m.itc.manual],
  ].filter(([, v]) => v !== 0).map(([k, v]) => `${k} ${exact(v as number)}`)
  const rows: { label: string; note: string; value: string }[] = [
    {
      label: 'Output tax',
      note: m.output.orders === 0 && m.output.manual === 0
        ? 'No delivered orders in the shipments export for this month'
        : `${m.output.orders} delivered ${m.output.orders === 1 ? 'order' : 'orders'}: IGST ${exact(m.output.igst)} · CGST ${exact(m.output.cgst)} · SGST ${exact(m.output.sgst)}${m.output.manual ? ` · entered ${exact(m.output.manual)}` : ''}`,
      value: exact(m.output.total),
    },
    { label: 'Input credit (estimate)', note: itcParts.length ? itcParts.join(' · ') : 'None yet', value: exact(m.itc.total) },
    { label: 'Credit ledger', note: `${exact(m.opening)} at the start, ${exact(m.closing)} left after this return`, value: m.payable > 0 ? `${exact(m.payable)} short` : 'Covers it' },
    { label: 'RCM, paid in cash', note: 'Fixed costs billed from abroad (Shopify, Claude, ChatGPT) and RCM entries: 18% IGST, claimed back as credit the same month', value: exact(m.rcm) },
  ]
  return (
    <div className="mt-6 border-t border-line pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className="font-semibold text-ink">{monthName(m.month)}{m.partial ? ' so far' : ''}</h3>
        <p className="text-sm"><Due label="GSTR-1" on={m.gstr1Due} today={today} /> · <Due label="GSTR-3B" on={m.gstr3bDue} today={today} /></p>
      </div>
      <p className="mt-2 text-ink-2">Cash with the GSTR-3B <span className="text-xl font-extrabold tracking-tight text-ink">{exact(m.cash)}</span>{m.cash > m.rcm ? <span className="text-sm"> (RCM {exact(m.rcm)} + tax {exact(m.payable)})</span> : null}</p>
      <dl className="mt-3 divide-y divide-line">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-2.5">
            <dt className="text-ink-2">{r.label}<span className="block max-w-[64ch] text-xs text-ink-3">{r.note}</span></dt>
            <dd className="font-semibold text-ink tabular-nums">{r.value}</dd>
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
      <section aria-labelledby="gst-h" className="rounded-xl bg-raised p-6">
        <h2 id="gst-h" className="text-base font-semibold text-ink">GST</h2>
        <p className="mt-2 text-ink-2">GST reads real data only, or could not be loaded: see the server log.</p>
      </section>
    )
  }
  const unfiled = g.months.filter((m) => !m.partial)
  const next = g.months[0]
  return (
    <section aria-labelledby="gst-h" className="rounded-xl bg-raised p-6">
      <h2 id="gst-h" className="text-base font-semibold text-ink">GST · one GSTIN, all stores</h2>
      {next ? (
        <p className="mt-2 text-3xl font-extrabold tracking-tight text-ink">{rs(next.cash)}<span className="ml-2 text-base font-semibold text-ink-2">{next.partial ? `so far for ${monthName(next.month)}` : `due with ${monthName(next.month)}'s GSTR-3B`}</span></p>
      ) : null}
      <p className="mt-1 text-sm text-ink-2">
        {g.seed
          ? <>Filed through {monthName(g.seed.month)}, leaving {exact(g.seed.balancePaise)} of credit (as entered on Settings). </>
          : <>No credit balance entered on Settings: the ledger starts at ₹0. </>}
        {unfiled.length > 0 ? <span className="text-warn">{unfiled.length} past {unfiled.length === 1 ? 'month' : 'months'} not marked filed. </span> : null}
        Estimate: the GSTR-2B decides the credit, and vFulfill and Meta invoices often reach it a month late. Late fees and interest not included.
      </p>
      {vfDaysAgo === null || vfDaysAgo > 3 ? (
        <p className="mt-2 text-sm text-warn">Output tax counts delivered orders from the vFulfill shipments export, last imported {vfDaysAgo === null ? 'never' : `${vfDaysAgo} days ago`}: orders delivered since are missing.</p>
      ) : null}
      {g.months.map((m) => <MonthBlock key={m.month} m={m} today={today} />)}
    </section>
  )
}

type Capital = ReturnType<typeof capitalSummary>

/** What VXP owes: loans with interest and due dates, then the partners' capital. */
export function CapitalCard({ c }: { c: Capital | null }) {
  if (!c) return null
  const open = c.loans.filter((l) => !l.settled)
  return (
    <section aria-labelledby="capital-h" className="rounded-xl bg-raised p-6">
      <h2 id="capital-h" className="text-base font-semibold text-ink">Capital &amp; loans · All VXP</h2>
      {c.loans.length === 0 && c.partners.length === 0 ? <p className="mt-2 text-ink-2">Nothing entered yet: add loans and partner capital on Settings.</p> : (
        <>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-ink">{rs(c.loanTotalDue)}<span className="ml-2 text-base font-semibold text-ink-2">owed on {open.length} {open.length === 1 ? 'loan' : 'loans'}</span></p>
          <dl className="mt-6 divide-y divide-line border-t border-line">
            {c.loans.map((l) => (
              <div key={l.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
                <dt className="text-ink-2">{l.name}
                  <span className="block text-xs text-ink-3">
                    {rs(l.amountPaise)} on {day(l.receivedOn)}{l.repaidPaise ? `, ${rs(l.repaidPaise)} repaid` : ''}
                    {l.interestRate ? ` · ${+(l.interestRate * 100).toFixed(2)}% a year: ${rs(l.interest)} interest so far` : ' · no interest'}
                  </span>
                  {l.settled ? <span className="block text-xs text-good">Repaid in full</span>
                    : l.daysOverdue !== null ? <span className="block text-xs font-semibold text-bad">Was due {day(l.dueOn!)}: {l.daysOverdue} days overdue</span>
                      : l.dueOn ? <span className="block text-xs text-ink-3">Due {day(l.dueOn)}</span> : null}
                </dt>
                <dd className="font-semibold text-ink">{rs(l.totalDue)}</dd>
              </div>
            ))}
            {c.partners.map((p) => (
              <div key={p.name} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
                <dt className="text-ink-2">{p.name}<span className="block text-xs text-ink-3">Partner capital, {p.entries.length} {p.entries.length === 1 ? 'entry' : 'entries'}{p.repaid ? `, ${rs(p.repaid)} returned` : ''}</span></dt>
                <dd className="font-semibold text-ink">{rs(p.outstanding)}</dd>
              </div>
            ))}
          </dl>
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
    <section aria-labelledby="forecast-h" className="rounded-xl bg-raised p-6">
      <h2 id="forecast-h" className="text-base font-semibold text-ink">Forecast · {scope}</h2>
      <p className={`mt-2 text-3xl font-extrabold tracking-tight ${tone(f.cumulative)}`}>{signed(f.cumulative)}<span className="ml-2 text-base font-semibold text-ink-2">running total from Day 1</span></p>
      <p className="mt-1 max-w-[80ch] text-sm text-ink-2">
        {f.opening.periodEnd ? <>Opens at {signed(f.opening.netPaise)} up to {day(f.opening.periodEnd)} (old Cash OS, before GST), then </> : <>From </>}
        every month of the P&amp;L above{f.rows.some((r) => r.partial) ? ', this month as it stands so far' : ''}. Net profit, ex-GST.
      </p>
      <div className="mt-6 grid gap-x-10 gap-y-6 border-t border-line pt-5 sm:grid-cols-2">
        <div>
          <p className="label">Average finished month</p>
          {f.average === null ? <p className="mt-1 text-ink-2">No finished month yet.</p> : (
            <p className="mt-1"><span className={`text-xl font-extrabold tracking-tight ${tone(f.average)}`}>{signed(f.average)}</span><span className="ml-2 text-sm text-ink-3">over {f.finishedMonths} {f.finishedMonths === 1 ? 'month' : 'months'}</span></p>
          )}
          {f.breakEven ? <p className="mt-2 text-sm text-good">At that pace the loss is cleared by {monthName(f.breakEven)}.</p>
            : f.cumulative >= 0 || f.average === null ? null
              : f.average > 0 ? <p className="mt-2 text-sm text-ink-3">At that pace it takes more than 10 years to clear the loss.</p>
                : f.average === 0 ? <p className="mt-2 text-sm text-ink-3">At that pace the loss stays where it is: no break-even date until the average turns positive.</p>
                  : <p className="mt-2 text-sm text-ink-3">At that pace the loss grows: no break-even date until the average turns positive.</p>}
        </div>
        {f.needed.length > 0 ? (
          <div>
            <p className="label">Net profit needed a month, from next month</p>
            <dl className="mt-1 space-y-1">
              {f.needed.map((n) => (
                <div key={n.months} className="flex items-baseline justify-between gap-6">
                  <dt className="text-ink-2">To clear it in {n.months} months</dt>
                  <dd className="font-semibold text-ink tabular-nums">{rs(n.perMonth)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : <p className="text-good">The running total is not negative: nothing left to win back.</p>}
      </div>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-sm tabular-nums">
          <thead>
            <tr className="border-b border-line">
              {['Month', 'Net profit', 'Running total'].map((h, i) => <th key={h} scope="col" className={`label py-2 font-normal ${i ? 'text-right' : ''}`}>{h}</th>)}
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
                <th scope="row" className="py-2 font-normal text-ink-2">{monthName(r.month)}{r.partial ? ' (so far)' : ''}</th>
                <td className={`py-2 text-right ${tone(r.net)}`}>{signed(r.net)}</td>
                <td className={`py-2 text-right font-semibold ${tone(r.cumulative)}`}>{signed(r.cumulative)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
