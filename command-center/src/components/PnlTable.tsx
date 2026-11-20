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

/**
 * Monthly P&L from real data: one column per month, newest first. `store` null shows the VXP total, which also
 * carries the costs no store does (vFulfill storage and subscription, shared fixed costs).
 */
export function PnlTable({ pnl, store, storeName, currentMonth }: { pnl: PnlResult; store: string | null; storeName: string; currentMonth: string }) {
  const months = [...pnl.months].reverse()
  const line = (m: (typeof months)[number]) => (store ? m.stores[store] : m.vxp)
  const shareRow = months.some((m) => line(m).ownerShare !== null)
  return (
    <section aria-labelledby="pnl-h" className="rounded-xl bg-raised p-6">
      <h2 id="pnl-h" className="text-base font-semibold text-ink">Monthly P&amp;L · {storeName}</h2>
      <p className="mt-1 max-w-[75ch] text-sm text-ink-3">
        Actual, ex-GST. A delivered order counts in the month it was delivered (vFulfill); an RTO or cancelled order earns ₹0 in
        the month it was placed but its fees count. {store ? 'Costs shared by all stores are in the All VXP view only.' : 'Includes costs shared by all stores.'}
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left tabular-nums">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="label py-2 pr-4 font-normal"><span className="sr-only">Line</span></th>
              {months.map((m) => (
                <th key={m.month} scope="col" className="label py-2 pl-4 text-right font-normal whitespace-nowrap">
                  {monthLabel(m.month)}{m.month === currentMonth ? <span className="block text-ink-3">to date</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.label} className={`border-b border-line ${r.strong ? 'font-semibold' : ''}`}>
                <th scope="row" className="py-3 pr-4 font-normal text-ink-2 whitespace-nowrap">
                  <span className={r.strong ? 'font-semibold text-ink' : ''}>{r.label}</span>
                  {r.note ? <span className="block text-xs text-ink-3">{r.note}</span> : null}
                </th>
                {months.map((m) => {
                  const l = line(m)
                  const v = r.value(l)
                  const tone = r.signed ? (v < 0 ? 'text-bad' : v > 0 ? 'text-good' : 'text-ink-3') : v === 0 ? 'text-ink-3' : 'text-ink'
                  return (
                    <td key={m.month} title={r.title?.(l) || undefined} className={`py-3 pl-4 text-right whitespace-nowrap ${tone}`}>
                      {v === 0 ? '—' : rs(v)}
                    </td>
                  )
                })}
              </tr>
            ))}
            {shareRow ? (
              <tr>
                <th scope="row" className="py-3 pr-4 font-normal text-ink-2">Your 50% share</th>
                {months.map((m) => {
                  const s = line(m).ownerShare
                  return <td key={m.month} className="py-3 pl-4 text-right whitespace-nowrap text-ink">{s === null || s === 0 ? '—' : rs(s)}</td>
                })}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {!store && months.some((m) => Object.keys(m.shared.vfByHead).length + Object.keys(m.shared.fixed).length > 0) ? (
        <p className="mt-3 text-xs text-ink-3">
          Shared costs this month: {breakdown({ ...months[0].shared.vfByHead, ...months[0].shared.fixed }).replaceAll('\n', ' · ') || 'none'}. The quarterly
          vFulfill subscription is spread over its 3 months.
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
