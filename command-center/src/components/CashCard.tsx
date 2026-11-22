import type { Metrics } from '@/lib/metrics'
import { inr } from '@/lib/metrics'
import { storeCash } from '@/lib/store-cash'
import type { StoreId } from '@/lib/types'

type Cash = NonNullable<ReturnType<Metrics['cash']>>
type Row = { label: string; value: React.ReactNode; note: string }

/** To the paisa: the wallet is checked against vFulfill's own page. */
const rupees = (n: number) => `${n < 0 ? '−' : ''}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** Says it is an estimate, how it is made, and where the money sits, by gateway. */
function settlementNote(s: NonNullable<Cash['settlements']>): string {
  const orders = s.reduce((n, x) => n + x.orders, 0)
  if (orders === 0) return 'Estimate: every prepaid order should have settled by now (T+2 working days)'
  const byGateway = new Map<string, number>()
  for (const x of s) byGateway.set(x.gateway, (byGateway.get(x.gateway) ?? 0) + x.amount)
  const parts = [...byGateway].map(([g, a]) => `${g} ${inr(a)}`).join(' · ')
  return `Estimate: ${orders} prepaid ${orders === 1 ? 'order' : 'orders'} from Shopify not settled yet (T+2 working days), after gateway fee + GST. ${parts}`
}

const codRow = (amount: number, orders: number): Row => ({
  label: 'COD due from vFulfill',
  value: inr(amount),
  note: orders > 0 ? `${orders} delivered COD ${orders === 1 ? 'order' : 'orders'} not remitted yet` : 'Every delivered COD order is remitted',
})

const settlementRow = (s: Cash['settlements'], total: number): Row => ({
  label: 'Gateway settlements',
  value: s ? inr(total) : <span className="text-ink-3">Not read</span>,
  note: s ? settlementNote(s) : 'Estimated from Shopify prepaid orders',
})

function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="mt-3 space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="glass-row grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 px-3 py-3">
          <dt className="font-semibold text-ink">{r.label}</dt>
          <dd className="text-right text-[1.3rem] font-bold tabular-nums whitespace-nowrap text-ink">{r.value}</dd>
          <dd className="col-span-2 mt-0.5 text-xs text-ink-3">{r.note}</dd>
        </div>
      ))}
    </dl>
  )
}

const PANEL = 'glass rise p-2'
const HERO = 'mt-3 px-3 text-[2.1rem] font-extrabold leading-none tracking-[-0.03em] tabular-nums text-ink'

/**
 * Money's cash card: the total, how many days of ad spend it covers, and each part with where it comes from.
 * A part not connected yet says so instead of counting as ₹0. With `store`, only that store's own money: its COD due
 * and settlements. Bank and the vFulfill wallet serve every store, so they stay in All VXP.
 */
export function CashCard({ c, store }: { c: Cash | null; store?: { id: StoreId; name: string } }) {
  if (!c) {
    return (
      <section aria-labelledby="cash-h" className={PANEL}>
        <h2 id="cash-h" className="px-3 pt-2 text-lg font-bold">Cash</h2>
        <p className="mt-3 px-3 pb-2 text-ink-2">No cash source yet: import vFulfill transactions or enter a bank balance.</p>
      </section>
    )
  }
  if (store) {
    const s = storeCash(c, store.id)
    return (
      <section aria-labelledby="cash-h" className={PANEL}>
        <h2 id="cash-h" className="px-3 pt-2 text-lg font-bold">Cash · {store.name}</h2>
        <p className={HERO}>{inr(s.total)}</p>
        <p className="mt-2 max-w-[75ch] px-3 text-sm text-ink-2">
          {store.name}&apos;s money on its way in: COD vFulfill owes and gateway settlements.
          {s.settlements ? null : <> Without gateway settlements.</>}{' '}
          Bank{s.shared.bank ? ` (${inr(s.shared.bank.amount)})` : ''} and the vFulfill wallet ({rupees(s.shared.vfulfillWallet)}) serve all
          stores, so they count in All VXP only.
        </p>
        <Rows rows={[codRow(s.codDue, s.codDueOrders), settlementRow(s.settlements, s.settlementsTotal)]} />
        <div className="pb-2" />
      </section>
    )
  }
  const rows: Row[] = [
    {
      label: 'Bank',
      value: c.bank ? inr(c.bank.amount) : <span className="text-ink-3">Not entered</span>,
      note: c.bank ? `Entered ${day(c.bank.enteredAt)}` : 'Not entered yet: add it in Settings (the gear in the top bar)',
    },
    {
      label: 'vFulfill wallet',
      value: rupees(c.vfulfillWallet),
      note: c.vfulfillAsOf ? `As of the last transaction imported, ${day(c.vfulfillAsOf)}` : 'No vFulfill transactions imported',
    },
    codRow(c.codDue, c.codDueOrders),
    settlementRow(c.settlements, c.settlementsTotal),
  ]
  return (
    <section aria-labelledby="cash-h" className={PANEL}>
      <h2 id="cash-h" className="px-3 pt-2 text-lg font-bold">Cash</h2>
      <p className={HERO}>{inr(c.total)}</p>
      <p className="mt-2 max-w-[75ch] px-3 text-sm text-ink-2">
        {c.missing.length > 0 ? <>Without {c.missing.join(' and ')}. </> : null}
        {c.bank && c.coversDays !== null
          ? <>Covers {Math.floor(c.coversDays)} days of ad spend at {inr(c.dailySpend)} a day (last 7 days).</>
          : c.bank ? <>No ad spend in the last 7 days.</> : <>Days of spend it covers shows once a bank balance is entered.</>}
      </p>
      <Rows rows={rows} />
      <div className="pb-2" />
    </section>
  )
}
