import Link from 'next/link'
import { AlertTriangle, ChevronRight, Search } from 'lucide-react'
import { inr, pct } from '@/lib/metrics'
import { rateOf, STATUS_LABEL, type OrderStats, type OrderView, type Outcome, type RateRow } from '@/lib/orders'
import { gatewayOf } from '@/lib/settlements'
import type { StoreId } from '@/lib/types'
import { StoreDot, type VfState } from './bits'

const rs = (paise: number) => inr(paise / 100)
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })

const STATUS_TONE: Record<OrderView['status'], string> = {
  delivered: 'text-good', rto: 'text-bad', in_transit: 'text-ink', not_shipped: 'text-ink-3', cancelled: 'text-ink-3',
}
const PAY_WORD = { cod: 'COD', prepaid: 'Prepaid', unknown: 'Unknown' } as const
const PAY_DOT = { cod: 'bg-cod', prepaid: 'bg-prepaid', unknown: 'bg-ink-3' } as const

type MonthName = { long: string; short: string }
export type MonthNav = {
  prev: MonthName & { href: string }
  current: MonthName
  next: (MonthName & { href: string }) | null
}

const seg = 'flex h-[30px] items-center rounded-[0.6rem] px-3 text-sm font-medium whitespace-nowrap transition-colors'

/** Month pill: previous (link), current (on), next (link, only when it exists). Short names below `sm`. */
export function MonthPill({ nav }: { nav: MonthNav }) {
  const name = (l: MonthName) => <><span className="sm:hidden">{l.short}</span><span className="hidden sm:inline">{l.long}</span></>
  return (
    <nav aria-label="Month" className="glass-pill flex items-center gap-0.5 p-[3px]">
      <Link href={nav.prev.href} className={`${seg} gap-1 text-ink-2 hover:text-ink`}>‹ {name(nav.prev)}</Link>
      <span aria-current="page" className={`${seg} glass-pill-on font-semibold text-ink`}>{name(nav.current)}</span>
      {nav.next ? <Link href={nav.next.href} className={`${seg} gap-1 text-ink-2 hover:text-ink`}>{name(nav.next)} ›</Link> : null}
    </nav>
  )
}

/** The verdict first: are orders coming back, and is the delivery data fresh enough to trust. */
export function OrdersVerdict({ s, context, monthName, short, nav, vf }: {
  s: OrderStats; context: string; monthName: string; short: string; nav: MonthNav; vf: VfState
}) {
  const verdict = s.rtoRate === null
    ? `Nothing resolved yet for ${monthName}.`
    : s.rto === 0
      ? 'Every resolved order was delivered.'
      : `${pct(s.rtoRate, 1)} of resolved orders came back, costing ${rs(s.rtoChargesPaise)} in vFulfill charges.`
  return (
    <section aria-label="Verdict" className="glass rise grid gap-x-8 gap-y-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
      <div className="flex flex-wrap items-center justify-between gap-3 lg:col-span-3">
        <p className="label">{context}</p>
        <MonthPill nav={nav} />
      </div>
      <div className="min-w-0 lg:self-center">
        <h1 className="text-balance text-[clamp(1.5rem,2.2vw,2.1rem)] font-extrabold leading-[1.12] tracking-[-0.025em]">{verdict}</h1>
        {vf.stale
          ? <p className="mt-1 flex max-w-[75ch] items-start gap-1.5 text-[0.8125rem] text-warn"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />The vFulfill shipments data {vf.phrase}: orders shipped since may read No shipment data.</p>
          : <p className="mt-1 text-xs text-ink-3">The vFulfill shipments data {vf.phrase}</p>}
      </div>
      <div className="border-line lg:border-l lg:pl-8">
        <p className="label">Delivered · {short} · vFulfill</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p className="text-[2.6rem] font-extrabold leading-none tracking-[-0.035em]">{s.delivered}<span className="ml-2 text-xl font-semibold tracking-normal text-ink-2">delivered</span></p>
          <span className="text-sm text-ink-2">{s.rto} RTO{s.rtoShareOfAll !== null && <> ({pct(s.rtoShareOfAll, 1)} of all orders)</>}{s.rtoRate !== null && <> · {pct(1 - s.rtoRate)} of resolved delivered</>}</span>
        </div>
      </div>
      <div className="border-line lg:border-l lg:pl-8">
        <p className="label">Booked · {short} · Shopify</p>
        <p className="mt-1 text-[2.6rem] font-extrabold leading-none tracking-[-0.035em]">{rs(s.bookedPaise)}</p>
        <p className="mt-1 text-sm text-ink-2">incl. GST, cancelled left out</p>
      </div>
    </section>
  )
}

function Stat({ label, value, note, className = '' }: { label: string; value: React.ReactNode; note?: React.ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 px-3 py-3 ${className}`}>
      <p className="label">{label}</p>
      <p className="mt-1 text-[1.3rem] font-bold leading-tight tabular-nums">{value}</p>
      {note ? <p className="mt-0.5 text-xs text-ink-3">{note}</p> : null}
    </div>
  )
}

/** Orders, in transit, RTO cost. RTO cost is a cost, not a signed result: no red. */
/** `noData`: of the not-shipped orders, those the shipments data should cover but doesn't (rows read "No shipment data"). */
export function OrderStatsRow({ s, noData = 0 }: { s: OrderStats; noData?: number }) {
  return (
    <section aria-label="Month at a glance" className="glass grid grid-cols-2 gap-x-2 p-2 md:grid-cols-3 md:divide-x md:divide-line">
      <Stat label="Orders" value={s.orders} note={s.cancelled > 0 ? `+ ${s.cancelled} cancelled before shipping` : 'None cancelled before shipping'} />
      <Stat label="In transit" value={s.inTransit} note={[s.notShipped > noData ? `${s.notShipped - noData} not shipped` : null, noData > 0 ? `${noData} no shipment data` : null].filter(Boolean).join(' · ') || '0 not shipped'} />
      <Stat
        label="RTO cost" value={<span className="text-ink">{rs(s.rtoChargesPaise)}</span>} className="col-span-2 md:col-span-1"
        note={s.rto > 0 ? `vFulfill charges, GST incl. Plus ${rs(s.rtoValuePaise)} of orders never paid` : 'No RTOs this month'}
      />
    </section>
  )
}

type PillItem = { href: string; label: string; on: boolean }

/** One-tap filter links in a pill. Below 30rem it scrolls sideways, with an edge fade. */
function PillLinks({ label, items, wrap = false }: { label: string; items: PillItem[]; wrap?: boolean }) {
  return (
    <div className="flex min-w-0 max-w-full items-center gap-2">
      <span className="label">{label}</span>
      <div role="group" aria-label={label} className={`glass-pill flex min-w-0 max-w-full items-center gap-0.5 overflow-x-auto p-[3px] no-scrollbar ${wrap ? 'max-[30rem]:flex-wrap max-[30rem]:overflow-visible max-[30rem]:rounded-2xl' : 'max-[30rem]:pr-6 max-[30rem]:[mask-image:linear-gradient(to_right,black_82%,transparent)]'}`}>
        {items.map((i) => (
          <Link key={i.label} href={i.href} aria-current={i.on ? 'true' : undefined}
            className={`${seg} ${i.on ? 'glass-pill-on font-semibold text-ink' : 'text-ink-2 hover:text-ink'}`}>{i.label}</Link>
        ))}
      </div>
    </div>
  )
}

const ROW = 'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 @min-[50rem]:items-baseline @min-[50rem]:grid-cols-[minmax(7rem,1.1fr)_5rem_minmax(6.5rem,1fr)_minmax(5rem,0.8fr)_minmax(9rem,1.6fr)_minmax(7rem,1.2fr)] @min-[60rem]:grid-cols-[minmax(8rem,1.1fr)_5.5rem_minmax(7rem,1fr)_minmax(5.5rem,0.8fr)_minmax(10rem,1.6fr)_minmax(8rem,1.2fr)_minmax(6rem,1fr)] [grid-template-areas:"name_value"_"line_line"] @min-[50rem]:[grid-template-areas:"name_placed_pay_value_status_ship"] @min-[60rem]:[grid-template-areas:"name_placed_pay_value_status_ship_product"]'
const head = 'label whitespace-nowrap leading-tight'

export type OrderFilters = {
  status: PillItem[]
  payment: PillItem[]
  /** Hidden inputs for the search form: store, month, status, pay (only those set). */
  hidden: Record<string, string>
  q: string
  clearHref: string | null
}

/** The orders table (dense variant) with its one-tap filters in the header. */
export function OrdersPanel({ rows, total, filters, storeName }: { rows: OrderView[]; total: number; filters: OrderFilters; storeName: (id: string) => string }) {
  const count = filters.clearHref ? `${rows.length} of ${total} listed` : `${total} listed, cancelled included`
  return (
    <section aria-labelledby="orders-h" className="glass rise p-2">
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 pt-2">
        <h2 id="orders-h" className="text-lg font-bold">Orders <span className="ml-1 font-medium text-ink-3">{rows.length}</span></h2>
        <p className="text-sm text-ink-3">{count}</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 px-3">
        <PillLinks label="Status" items={filters.status} wrap />
        <PillLinks label="Pay" items={filters.payment} />
        <form action="/orders" className="flex items-center gap-2">
          {Object.entries(filters.hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <div className="glass-pill flex h-10 w-44 items-center">
            <input type="search" name="q" defaultValue={filters.q} placeholder="#OV3119…" maxLength={40} aria-label="Order name"
              className="h-full min-w-0 flex-1 bg-transparent pl-3 text-sm text-ink outline-none placeholder:text-ink-3" />
            <button type="submit" aria-label="Search orders" className="flex size-10 shrink-0 items-center justify-center rounded-lg text-ink-2 hover:text-ink"><Search className="size-4" aria-hidden /></button>
          </div>
          {filters.clearHref ? <Link href={filters.clearHref} className="flex h-10 items-center text-sm text-ink-2 hover:text-ink">Clear</Link> : null}
        </form>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 px-3 pb-2 text-ink-2">No orders match.</p>
      ) : (
        <div role="table" aria-label="Orders" className="@container mt-3 tabular-nums">
          <div role="row" className={`${ROW} hidden px-3 pb-2 @min-[50rem]:grid`}>
            <span role="columnheader" className={`${head} [grid-area:name]`}>Order</span>
            <span role="columnheader" className={`${head} [grid-area:placed]`}>Placed</span>
            <span role="columnheader" className={`${head} [grid-area:pay]`}>Payment</span>
            <span role="columnheader" className={`${head} [grid-area:value] text-right`}>Value</span>
            <span role="columnheader" className={`${head} [grid-area:status]`}>Status</span>
            <span role="columnheader" className={`${head} [grid-area:ship]`}>Ship to</span>
            <span role="columnheader" className={`${head} hidden [grid-area:product] @min-[60rem]:block`}>Product</span>
          </div>
          <div className="divide-y divide-line">
            {rows.map((o) => <OrderRow key={`${o.storeId}${o.orderName}`} o={o} store={storeName(o.storeId)} />)}
          </div>
        </div>
      )}
    </section>
  )
}

function OrderRow({ o, store }: { o: OrderView; store: string }) {
  const place = [o.city, o.state].filter(Boolean).join(', ')
  // Not shipped, or only missing from the shipments data: the backend tells them apart (noShipmentData).
  const label = o.noShipmentData ? 'No shipment data' : STATUS_LABEL[o.status]
  const toneCls = o.noShipmentData ? 'text-warn' : STATUS_TONE[o.status]
  const raw = o.statusRaw && o.statusRaw.toLowerCase() !== label.toLowerCase() ? o.statusRaw : null
  const gateway = o.payment === 'prepaid' && o.gateways.length > 0 ? (gatewayOf(o.gateways) ?? o.gateways.join(', ')) : null
  return (
    <div role="row" className={`${ROW} px-3 py-2.5 text-sm`}>
      <span role="cell" className="min-w-0 [grid-area:name]">
        <span className="flex items-center gap-2 font-semibold text-ink"><StoreDot id={o.storeId as StoreId} />{o.orderName}<span className="min-w-0 truncate text-xs font-normal text-ink-3 @min-[50rem]:hidden">{store}</span></span>
        <span className="hidden text-xs text-ink-3 @min-[50rem]:block">{store}<span className="@min-[60rem]:hidden"> · {o.sku ?? 'No product'}</span></span>
      </span>
      <span role="cell" className="hidden whitespace-nowrap text-ink-2 [grid-area:placed] @min-[50rem]:block">{day(o.date)}</span>
      <span role="cell" className="hidden min-w-0 text-ink-2 [grid-area:pay] @min-[50rem]:block">
        <span className="flex items-center gap-2"><span aria-hidden className={`size-2 shrink-0 rounded-full ${PAY_DOT[o.payment]}`} />{PAY_WORD[o.payment]}</span>
        {gateway ? <span className="block text-xs text-ink-3">{gateway}</span> : null}
      </span>
      <span role="cell" className="text-right font-semibold text-ink [grid-area:value]">{rs(o.totalPaise)}</span>
      <span role="cell" className="hidden min-w-0 [grid-area:status] @min-[50rem]:block">
        <span className={`font-semibold ${toneCls}`}>{label}</span>
        {raw ? <span className="text-ink-3"> ({raw})</span> : null}
        {o.closedOn && o.status !== 'in_transit' ? <span className="block text-xs text-ink-3">{day(o.closedOn)}{o.status === 'rto' ? ` · ${rs(o.rtoChargesPaise)} charged` : ''}</span>
          : o.status === 'rto' ? <span className="block text-xs text-ink-3">{rs(o.rtoChargesPaise)} charged</span> : null}
      </span>
      <span role="cell" className="hidden min-w-0 text-ink-2 [grid-area:ship] @min-[50rem]:block">{place || <span className="text-ink-3">Not known</span>}</span>
      <span role="cell" className="hidden text-ink-2 [grid-area:product] @min-[60rem]:block">{o.sku ?? <span className="text-ink-3">None</span>}</span>
      {/* Phones: one tap opens the fields the table shows as columns. Native details, no JS. */}
      <span role="cell" className="min-w-0 [grid-area:line] @min-[50rem]:hidden">
        <details className="group">
          <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 text-xs text-ink-3 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1 truncate">
              <span className={`font-semibold ${toneCls}`}>{label}</span> · {PAY_WORD[o.payment]} · {day(o.date)}{o.city ? ` · ${o.city}` : ''}
            </span>
            <span aria-hidden className="flex size-4 shrink-0 items-center justify-center"><ChevronRight className="size-4 transition-transform group-open:[transform:rotate(90deg)]" /></span>
          </summary>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            <Pair k="Store" v={store} />
            <Pair k="Payment" v={gateway ? `${PAY_WORD[o.payment]} · ${gateway}` : PAY_WORD[o.payment]} />
            <Pair k="Product" v={o.sku ?? 'None'} />
            <Pair k="Ship to" v={place || 'Not known'} />
            <Pair k="Status" v={raw ? `${label} (${raw})` : label} />
            {o.closedOn && o.status !== 'in_transit' ? <Pair k={o.status === 'rto' ? 'Closed' : 'Delivered'} v={day(o.closedOn)} /> : null}
            {o.status === 'rto' ? <Pair k="RTO charged" v={rs(o.rtoChargesPaise)} /> : null}
          </dl>
        </details>
      </span>
    </div>
  )
}

function Pair({ k, v }: { k: string; v: string }) {
  return <><dt className="text-ink-3">{k}</dt><dd className="min-w-0 break-words text-ink-2">{v}</dd></>
}

function Cell({ o }: { o: Outcome }) {
  const r = rateOf(o)
  if (r === null) return <span role="cell" className="text-right text-ink-3">–</span>
  return (
    <span role="cell" className="text-right">
      <span className="block text-base font-bold text-ink">{pct(r)}</span>
      <span className="block text-xs text-ink-3">{o.delivered} / {o.delivered + o.rto}</span>
    </span>
  )
}

const RATE_ROW = 'grid grid-cols-[minmax(5.5rem,1.4fr)_repeat(3,minmax(3.75rem,1fr))] items-baseline gap-x-2'

/** Delivery rate (delivered ÷ resolved) per group, COD and prepaid apart. Dense rows, one layout at every width. */
export function RatesTable({ title, note, by, rows }: { title: string; note: string; by: string; rows: RateRow[] }) {
  const sub = <span className="block text-[0.6875rem] font-normal normal-case tracking-normal text-ink-3">Resolved · vFulfill</span>
  return (
    <section className="glass rise p-2">
      <div className="px-3 pt-2">
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="mt-1 text-xs text-ink-3">{note}</p>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 px-3 pb-2 text-ink-2">No resolved orders this month.</p>
      ) : (
        <div role="table" aria-label={title} className="mt-3 tabular-nums">
          <div role="row" className={`${RATE_ROW} px-3 pb-2`}>
            <span role="columnheader" className="label leading-tight">{by}{sub}</span>
            {['COD', 'Prepaid', 'All'].map((h) => <span key={h} role="columnheader" className="label text-right leading-tight">{h}</span>)}
          </div>
          <div className="divide-y divide-line">
            {rows.map((r) => (
              <div role="row" key={r.label} className={`${RATE_ROW} px-3 py-2.5`}>
                <span role="rowheader" className="min-w-0 text-sm text-ink-2">{r.label}</span>
                <Cell o={r.cod} /><Cell o={r.prepaid} /><Cell o={r.all} />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
