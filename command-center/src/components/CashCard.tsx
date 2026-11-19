import type { Metrics } from '@/lib/metrics'
import { inr } from '@/lib/metrics'

type Cash = NonNullable<ReturnType<Metrics['cash']>>

/** To the paisa: the wallet is checked against vFulfill's own page. */
const rupees = (n: number) => `${n < 0 ? '−' : ''}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/**
 * Money's cash card: the total, how many days of ad spend it covers, and each part with where it comes from.
 * A part not connected yet says so instead of counting as ₹0.
 */
export function CashCard({ c }: { c: Cash | null }) {
  if (!c) {
    return (
      <section aria-labelledby="cash-h" className="rounded-xl bg-raised p-6">
        <h2 id="cash-h" className="text-base font-semibold text-ink">Cash</h2>
        <p className="mt-2 text-ink-2">No cash source yet: import vFulfill transactions or enter a bank balance.</p>
      </section>
    )
  }
  const rows: { label: string; value: React.ReactNode; note: string }[] = [
    {
      label: 'Bank',
      value: c.bank ? inr(c.bank.amount) : <span className="text-ink-3">Not entered</span>,
      note: c.bank ? `Entered ${day(c.bank.enteredAt)}` : 'Run scripts/bank-balance.ts --amount <rupees>',
    },
    {
      label: 'vFulfill wallet',
      value: rupees(c.vfulfillWallet),
      note: c.vfulfillAsOf ? `As of the last transaction imported, ${day(c.vfulfillAsOf)}` : 'No vFulfill transactions imported',
    },
    {
      label: 'COD due from vFulfill',
      value: inr(c.codDue),
      note: c.codDueOrders > 0 ? `${c.codDueOrders} delivered COD ${c.codDueOrders === 1 ? 'order' : 'orders'} not remitted yet` : 'Every delivered COD order is remitted',
    },
    {
      label: 'Gateway settlements',
      value: c.settlements ? inr(c.settlementsTotal) : <span className="text-ink-3">Not connected</span>,
      note: c.settlements ? 'Captured, not yet settled' : 'Razorpay, PayU and Cashfree connect in a later stage',
    },
  ]
  return (
    <section aria-labelledby="cash-h" className="rounded-xl bg-raised p-6">
      <h2 id="cash-h" className="text-base font-semibold text-ink">Cash</h2>
      <p className="mt-2 text-3xl font-extrabold tracking-tight text-ink">{inr(c.total)}</p>
      <p className="mt-1 text-sm text-ink-2">
        {c.missing.length > 0 ? <>Without {c.missing.join(' and ')}. </> : null}
        {c.bank && c.coversDays !== null
          ? <>Covers {Math.floor(c.coversDays)} days of ad spend at {inr(c.dailySpend)} a day (last 7 days).</>
          : c.bank ? <>No ad spend in the last 7 days.</> : <>Days of spend it covers shows once a bank balance is entered.</>}
      </p>
      <dl className="mt-6 divide-y divide-line border-t border-line">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
            <dt className="text-ink-2">{r.label}<span className="block text-xs text-ink-3">{r.note}</span></dt>
            <dd className="font-semibold text-ink">{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
