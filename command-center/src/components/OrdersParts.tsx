import { inr, pct } from '@/lib/metrics'
import { rateOf, STATUS_LABEL, type OrderStats, type OrderView, type Outcome, type RateRow } from '@/lib/orders'
import { gatewayOf } from '@/lib/settlements'
import type { StoreId } from '@/lib/types'
import { StoreDot } from './bits'

const rs = (paise: number) => inr(paise / 100)
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })

const STATUS_TONE: Record<OrderView['status'], string> = {
  delivered: 'text-good', rto: 'text-bad', in_transit: 'text-ink', not_shipped: 'text-ink-3', cancelled: 'text-ink-3',
}

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-raised p-5">
      <p className="label">{label}</p>
      <p className="mt-2 text-2xl font-extrabold tracking-tight text-ink tabular-nums">{value}</p>
      {note ? <p className="mt-1 text-xs text-ink-3">{note}</p> : null}
    </div>
  )
}

/** The month at a glance. RTO rate is over resolved orders; the old app's share of all orders is in the note. */
export function OrderStatsRow({ s }: { s: OrderStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Stat label="Orders" value={s.orders} note={s.cancelled > 0 ? `+ ${s.cancelled} cancelled before shipping` : 'None cancelled before shipping'} />
      <Stat label="Delivered" value={s.delivered} note={`${s.inTransit} in transit · ${s.notShipped} not shipped`} />
      <Stat
        label="RTO" value={s.rto}
        note={s.rtoRate === null ? 'Nothing resolved yet' : `${pct(s.rtoRate, 1)} of resolved · ${pct(s.rtoShareOfAll ?? 0, 1)} of all orders`}
      />
      <Stat label="Booked" value={rs(s.bookedPaise)} note="Order value incl. GST, cancelled left out" />
      <Stat label="RTO cost" value={rs(s.rtoChargesPaise)} note={s.rto > 0 ? `vFulfill charges, GST incl. Plus ${rs(s.rtoValuePaise)} of orders never paid` : 'No RTOs this month'} />
    </div>
  )
}

/** Every order matching the filters, newest first. */
export function OrdersTable({ rows, storeName }: { rows: OrderView[]; storeName: (id: string) => string }) {
  if (rows.length === 0) return <p className="rounded-xl bg-raised p-6 text-ink-2">No orders match.</p>
  return (
    <div className="overflow-x-auto rounded-xl bg-raised">
      <table className="w-full min-w-[880px] text-left text-sm tabular-nums">
        <thead>
          <tr className="border-b border-line">
            {['Order', 'Placed', 'Payment', 'Value', 'Status', 'Ship to', 'Product'].map((h, i) => (
              <th key={h} scope="col" className={`label px-4 py-3 font-normal ${i === 3 ? 'text-right' : ''}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={`${o.storeId}${o.orderName}`} className="border-b border-line last:border-0">
              <th scope="row" className="px-4 py-3 font-semibold text-ink whitespace-nowrap">
                <span className="inline-flex items-center gap-2"><StoreDot id={o.storeId as StoreId} />{o.orderName}</span>
                <span className="block text-xs font-normal text-ink-3">{storeName(o.storeId)}</span>
              </th>
              <td className="px-4 py-3 text-ink-2 whitespace-nowrap">{day(o.date)}</td>
              <td className="px-4 py-3 text-ink-2">
                {o.payment === 'cod' ? 'COD' : o.payment === 'prepaid' ? 'Prepaid' : 'Unknown'}
                {o.payment === 'prepaid' && o.gateways.length > 0 ? <span className="block text-xs text-ink-3">{gatewayOf(o.gateways) ?? o.gateways.join(', ')}</span> : null}
              </td>
              <td className="px-4 py-3 text-right text-ink">{rs(o.totalPaise)}</td>
              <td className="px-4 py-3">
                <span className={`font-semibold ${STATUS_TONE[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                {o.statusRaw && o.statusRaw.toLowerCase() !== STATUS_LABEL[o.status].toLowerCase() ? <span className="text-ink-3"> ({o.statusRaw})</span> : null}
                {o.closedOn && o.status !== 'in_transit' ? <span className="block text-xs text-ink-3">{day(o.closedOn)}</span> : null}
                {o.status === 'rto' ? <span className="block text-xs text-ink-3">{rs(o.rtoChargesPaise)} charged</span> : null}
              </td>
              <td className="px-4 py-3 text-ink-2">{[o.city, o.state].filter(Boolean).join(', ') || <span className="text-ink-3">Not known</span>}</td>
              <td className="px-4 py-3 text-ink-2">{o.sku ?? <span className="text-ink-3">None</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Cell({ o }: { o: Outcome }) {
  const r = rateOf(o)
  if (r === null) return <td className="px-4 py-3 text-right text-ink-3">–</td>
  return (
    <td className="px-4 py-3 text-right">
      <span className="text-ink">{pct(r)}</span>
      <span className="block text-xs text-ink-3">{o.delivered} / {o.delivered + o.rto}</span>
    </td>
  )
}

/** Delivery rate (delivered ÷ resolved) per group, COD and prepaid apart. */
export function RatesTable({ title, note, by, rows }: { title: string; note: string; by: string; rows: RateRow[] }) {
  return (
    <section className="rounded-xl bg-raised p-6">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <p className="mt-1 text-sm text-ink-3">{note}</p>
      {rows.length === 0 ? (
        <p className="mt-4 text-ink-2">No resolved orders this month.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm tabular-nums">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="label py-2 pr-4 font-normal">{by}</th>
                {['COD', 'Prepaid', 'All'].map((h) => <th key={h} scope="col" className="label px-4 py-2 text-right font-normal">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b border-line last:border-0">
                  <th scope="row" className="py-3 pr-4 font-normal text-ink-2">{r.label}</th>
                  <Cell o={r.cod} /><Cell o={r.prepaid} /><Cell o={r.all} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
