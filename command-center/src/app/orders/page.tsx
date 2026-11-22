import { Suspense } from 'react'
import { MonthPill, OrderStatsRow, OrdersPanel, OrdersVerdict, RatesTable, type MonthNav, type OrderFilters } from '@/components/OrdersParts'
import { Skeleton } from '@/components/Skeleton'
import { TopBar } from '@/components/TopBar'
import { getChrome } from '@/lib/data'
import { istNow } from '@/lib/dates'
import { readView } from '@/lib/nav'
import { deliveryRates, filterOrders, orderStats, shiftMonth, STATUS_LABEL, type OrderFilter, type OrderPayment, type OrderStatus, type OrderView } from '@/lib/orders'
import { loadOrdersMonth } from '@/lib/orders-load'

export default function Page({ searchParams }: PageProps<'/orders'>) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Orders searchParams={searchParams} />
    </Suspense>
  )
}

type Raw = Record<string, string | string[] | undefined>
const one = (p: Raw, k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '')
const STATUSES = Object.keys(STATUS_LABEL) as OrderStatus[]
const PAYMENTS: { id: OrderPayment; label: string }[] = [{ id: 'cod', label: 'COD' }, { id: 'prepaid', label: 'Prepaid' }, { id: 'unknown', label: 'Unknown' }]
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })

async function Orders({ searchParams }: { searchParams: PageProps<'/orders'>['searchParams'] }) {
  const d = await getChrome()
  const params = await searchParams
  const view = readView(params, d.stores)
  const current = istNow(d.now).today.slice(0, 7)
  const asked = one(params, 'month')
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) && asked <= current ? asked : current
  const filter: OrderFilter = {
    status: STATUSES.includes(one(params, 'status') as OrderStatus) ? (one(params, 'status') as OrderStatus) : null,
    payment: PAYMENTS.some((p) => p.id === one(params, 'pay')) ? (one(params, 'pay') as OrderPayment) : null,
    q: one(params, 'q').slice(0, 40),
  }
  const storeName = (id: string) => d.stores.find((s) => s.id === id)?.name ?? id

  /** This page's URL with some params changed; the store and month carry over. */
  const link = (over: Partial<Record<'month' | 'status' | 'pay' | 'q', string | null>>) => {
    const q = new URLSearchParams()
    if (view.store !== 'all') q.set('store', view.store)
    const merged = { month, status: filter.status, pay: filter.payment, q: filter.q || null, ...over }
    for (const [k, v] of Object.entries(merged)) if (v && !(k === 'month' && v === current)) q.set(k, v)
    const s = q.toString()
    return s ? `/orders?${s}` : '/orders'
  }

  let rows: OrderView[] | null = null
  let error: string | null = null
  if (d.source === 'supabase') {
    try {
      rows = await loadOrdersMonth(month, view.store === 'all' ? d.stores.map((s) => s.id) : [view.store])
    } catch (e) {
      console.error(`orders: ${e instanceof Error ? e.message : String(e)}`)
      error = 'Orders could not be loaded. Try again; if it keeps failing, check the server log.'
    }
  }
  const shown = rows ? filterOrders(rows, filter) : []
  const filtered = filter.status !== null || filter.payment !== null || filter.q !== ''
  const ageDays = d.sync.vfulfillImportDaysAgo
  // Switching store keeps the month and filters (the top bar's links to /orders carry them).
  const keep: Record<string, string> = {}
  if (month !== current) keep.month = month
  if (filter.status) keep.status = filter.status
  if (filter.payment) keep.pay = filter.payment
  if (filter.q) keep.q = filter.q

  const monthShort = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' })
  const name = (m: string) => ({ long: monthLabel(m), short: monthShort(m) })
  const nav: MonthNav = {
    prev: { href: link({ month: shiftMonth(month, -1) }), ...name(shiftMonth(month, -1)) },
    current: name(month),
    next: month < current ? { href: link({ month: shiftMonth(month, 1) }), ...name(shiftMonth(month, 1)) } : null,
  }
  const hidden: Record<string, string> = {}
  if (view.store !== 'all') hidden.store = view.store
  if (month !== current) hidden.month = month
  if (filter.status) hidden.status = filter.status
  if (filter.payment) hidden.pay = filter.payment
  const filters: OrderFilters = {
    status: [{ href: link({ status: null }), label: 'All', on: filter.status === null }, ...STATUSES.map((s) => ({ href: link({ status: s }), label: STATUS_LABEL[s], on: filter.status === s }))],
    payment: [{ href: link({ pay: null }), label: 'All', on: filter.payment === null }, ...PAYMENTS.map((p) => ({ href: link({ pay: p.id }), label: p.label, on: filter.payment === p.id }))],
    hidden,
    q: filter.q,
    clearHref: filtered ? link({ status: null, pay: null, q: null }) : null,
  }
  const message = (text: string | null) => (
    <section className="glass flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-ink-2">
      <p>{text}</p>
      <MonthPill nav={nav} />
    </section>
  )

  return (
    <>
      <TopBar tab="orders" view={{ ...view, keep: { path: '/orders', params: keep } }} d={d} />
      <main className="mx-auto max-w-[1536px] space-y-3 px-3 pb-6 pt-3 sm:px-4">
        {d.source !== 'supabase' ? (
          message('Orders read real data only: set DATA_SOURCE=supabase.')
        ) : error || !rows ? (
          message(error)
        ) : (
          <>
            <OrdersVerdict
              s={orderStats(rows)} nav={nav} ageDays={ageDays} monthName={monthLabel(month)} short={monthShort(month)}
              context={`Orders · ${monthLabel(month)} · ${view.store === 'all' ? 'All VXP' : storeName(view.store)}`}
            />
            <OrderStatsRow s={orderStats(rows)} />
            <OrdersPanel rows={shown} total={rows.length} filters={filters} storeName={storeName} />
            <div className="grid items-start gap-3 lg:grid-cols-2">
              {view.store === 'all' ? (
                <RatesTable title="Delivery rate by store" by="Store" rows={deliveryRates(rows, (o) => storeName(o.storeId))}
                  note="Delivered ÷ (delivered + RTO) among this month's orders. Unknown payment counts in All only." />
              ) : null}
              <RatesTable title="Delivery rate by state" by="State" rows={deliveryRates(rows, (o) => o.state ?? 'Not known')}
                note="Same measure, by ship-to state. Small counts swing: read the n under each rate." />
            </div>
            <p className="max-w-[80ch] px-1 text-xs text-ink-3">
              Orders placed in {monthLabel(month)}. Delivery status comes from the vFulfill shipments export
              {ageDays === null ? ', which has never been imported' : `, last imported ${ageDays === 0 ? 'today' : `${ageDays} day${ageDays === 1 ? '' : 's'} ago`}`}:
              an order shipped since then shows as not shipped.
            </p>
          </>
        )}
      </main>
    </>
  )
}
