import { inr } from '@/lib/metrics'
import type { PnlLine, PnlResult } from '@/lib/pnl'

const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const rs = (paise: number) => inr(paise / 100)
const breakdown = (rec: Record<string, number>) =>
  Object.entries(rec).filter(([, v]) => v !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([k, v]) => `${k}: ${rs(v)}`).join('\n')

type Row = { label: string; note?: string; value: (l: PnlLine) => number; title?: (l: PnlLine) => string; strong?: boolean; signed?: boolean }

const ROWS: Row[] = [
  { label: 'Revenue', note: 'Delivered orders, ex-GST', value: (l) => l.revenueNet, title: (l) => `${l.orders.delivered} delivered · ${rs(l.revenueGross)} incl. GST` },
  { label: 'COGS', value: (l) => -l.cogs, title: (l) => (l.cogsMissing ? `${l.cogsMissing} delivered order(s) with no cost on record` : '') },
  { label: 'vFulfill fees', note: 'Actual charges', value: (l) => -l.vfFees, title: (l) => breakdown(l.vfByHead) },
  { label: 'Checkout (Fastrr)', note: '2% of every order', value: (l) => -l.checkoutFees },
  { label: 'Gateway', note: 'Prepaid, computed', value: (l) => -l.gatewayFees },
  { label: 'Meta ad spend', value: (l) => -l.adSpend },
  { label: 'Fixed costs', value: (l) => -l.fixedCosts },
  { label: 'Net profit', value: (l) => l.netProfit, strong: true, signed: true },
]

const tone = (v: number, signed: boolean) => (signed ? (v < 0 ? 'text-bad' : v > 0 ? 'text-good' : 'text-ink-2') : v === 0 ? 'text-ink-2' : 'text-ink')
const show = (v: number, signed: boolean) => (v === 0 ? '—' : `${signed && v > 0 ? '+' : ''}${rs(v)}`)

/**
 * Monthly P&L from real data: one column per month, newest first. `store` null shows the VXP total, which also
 * carries the costs no store does (vFulfill storage and subscription, shared fixed costs). Wide panel: a table.
 * Narrow panel: one stacked card per month, so it never overflows a phone.
 */
export function PnlTable({ pnl, store, storeName, currentMonth }: { pnl: PnlResult; store: string | null; storeName: string; currentMonth: string }) {
  const months = [...pnl.months].reverse()
  const line = (m: (typeof months)[number]) => (store ? m.stores[store] : m.vxp)
  const shareRow = months.some((m) => line(m).ownerShare !== null)
  const share = (m: (typeof months)[number]) => line(m).ownerShare ?? 0
  return (
    <section aria-labelledby="pnl-h" className="glass rise p-5">
      <h2 id="pnl-h" className="text-lg font-bold">Monthly P&amp;L · {storeName}</h2>
      <p className="mt-1 max-w-[75ch] text-sm text-ink-3">
        Actual, ex-GST. A delivered order counts in the month it was delivered (vFulfill); an RTO or cancelled order earns ₹0 in
        the month it was placed but its fees count. {store ? 'Costs shared by all stores are in the All VXP view only.' : 'Includes costs shared by all stores.'}
      </p>
      <div className="@container mt-3">
        <div className="hidden overflow-x-auto @min-[50rem]:block">
          <table className="w-full text-left tabular-nums">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="label py-2 pr-4 font-normal"><span className="sr-only">Line</span></th>
                {months.map((m) => (
                  <th key={m.month} scope="col" className="label py-2 pl-4 text-right font-normal whitespace-nowrap">
                    {monthLabel(m.month)}{m.month === currentMonth ? <span className="block text-[0.6875rem] normal-case tracking-normal text-ink-3">to date</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.label} className="border-b border-line">
                  <th scope="row" className="py-3 pr-4 font-normal text-ink-2 whitespace-nowrap">
                    <span className={r.strong ? 'font-bold text-ink' : ''}>{r.label}</span>
                    {r.note ? <span className="block text-xs text-ink-3">{r.note}</span> : null}
                  </th>
                  {months.map((m) => {
                    const l = line(m)
                    const v = r.value(l)
                    return (
                      <td key={m.month} title={r.title?.(l) || undefined} className={`py-3 pl-4 text-right whitespace-nowrap ${r.strong ? 'text-[1.125rem] font-bold' : ''} ${tone(v, !!r.signed)}`}>
                        {show(v, !!r.signed)}
                      </td>
                    )
                  })}
                </tr>
              ))}
              {shareRow ? (
                <tr>
                  <th scope="row" className="py-3 pr-4 font-normal text-ink-2">Your 50% share</th>
                  {months.map((m) => (
                    <td key={m.month} className={`py-3 pl-4 text-right whitespace-nowrap font-semibold ${tone(share(m), true)}`}>{show(share(m), true)}</td>
                  ))}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="space-y-1.5 @min-[50rem]:hidden">
          {months.map((m) => {
            const l = line(m)
            return (
              <div key={m.month} className="glass-row px-3 py-3">
                <p className="flex items-baseline justify-between gap-3">
                  <span className="text-base font-bold">{monthLabel(m.month)}{m.month === currentMonth ? <span className="ml-2 text-xs font-normal text-ink-3">to date</span> : null}</span>
                </p>
                <dl className="mt-2 divide-y divide-line tabular-nums">
                  {ROWS.map((r) => {
                    const v = r.value(l)
                    return (
                      <div key={r.label} title={r.title?.(l) || undefined} className="flex items-baseline justify-between gap-4 py-1.5">
                        <dt className={`min-w-0 ${r.strong ? 'font-bold text-ink' : 'text-ink-2'}`}>{r.label}{r.note ? <span className="block text-xs text-ink-3">{r.note}</span> : null}</dt>
                        <dd className={`text-right whitespace-nowrap ${r.strong ? 'text-[1.3rem] font-bold' : ''} ${tone(v, !!r.signed)}`}>{show(v, !!r.signed)}</dd>
                      </div>
                    )
                  })}
                  {shareRow ? (
                    <div className="flex items-baseline justify-between gap-4 py-1.5">
                      <dt className="text-ink-2">Your 50% share</dt>
                      <dd className={`text-right whitespace-nowrap font-semibold ${tone(share(m), true)}`}>{show(share(m), true)}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            )
          })}
        </div>
      </div>
      {!store && months.some((m) => Object.keys(m.shared.vfByHead).length + Object.keys(m.shared.fixed).length > 0) ? (
        <p className="mt-3 text-xs text-ink-3">
          Shared costs this month: {breakdown({ ...months[0].shared.vfByHead, ...months[0].shared.fixed }).replaceAll('\n', ' · ') || 'none'}. The quarterly
          vFulfill subscription counts in full in the month it bills, nothing in the two between.
        </p>
      ) : null}
      {pnl.warnings.length > 0 ? (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-warn marker:text-warn">
          {pnl.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      ) : null}
    </section>
  )
}
