import Link from 'next/link'
import { Suspense } from 'react'
import { OrdersTable, OrderStatsRow, RatesTable } from '@/components/OrdersParts'
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

  return (
    <>
      <TopBar tab="orders" view={{ ...view, keep: { path: '/orders', params: keep } }} d={d} />
      <main className="mx-auto max-w-[1440px] px-4 py-10 sm:px-8 lg:px-10">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">Orders</h1>
          <nav aria-label="Month" className="flex items-center gap-3 text-sm">
            <Link href={link({ month: shiftMonth(month, -1) })} className="rounded-md px-2 py-1 text-ink-2 hover:text-ink">‹ {monthLabel(shiftMonth(month, -1))}</Link>
            <span className="font-semibold text-ink">{monthLabel(month)}</span>
            {month < current
              ? <Link href={link({ month: shiftMonth(month, 1) })} className="rounded-md px-2 py-1 text-ink-2 hover:text-ink">{monthLabel(shiftMonth(month, 1))} ›</Link>
              : null}
          </nav>
        </div>

        {d.source !== 'supabase' ? (
          <p className="mt-8 rounded-xl bg-raised p-6 text-ink-2">Orders read real data only: set DATA_SOURCE=supabase.</p>
        ) : error || !rows ? (
          <p className="mt-8 rounded-xl bg-raised p-6 text-ink-2">{error}</p>
        ) : (
          <>
            <p className="mt-2 max-w-[75ch] text-sm text-ink-3">
              Orders placed in {monthLabel(month)}. Delivery status comes from the vFulfill shipments export
              {ageDays === null ? ', which has never been imported' : `, last imported ${ageDays === 0 ? 'today' : `${ageDays} day${ageDays === 1 ? '' : 's'} ago`}`}:
              an order shipped since then shows as not shipped.
            </p>
            <div className="mt-6"><OrderStatsRow s={orderStats(rows)} /></div>

            <form action="/orders" className="mt-8 flex flex-wrap items-end gap-3 text-sm">
              {view.store !== 'all' ? <input type="hidden" name="store" value={view.store} /> : null}
              {month !== current ? <input type="hidden" name="month" value={month} /> : null}
              <label className="flex flex-col gap-1 text-ink-2">Status
                <select name="status" defaultValue={filter.status ?? ''} className="rounded-md border border-line bg-raised px-3 py-2 text-ink">
                  <option value="">All</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-ink-2">Payment
                <select name="pay" defaultValue={filter.payment ?? ''} className="rounded-md border border-line bg-raised px-3 py-2 text-ink">
                  <option value="">All</option>
                  {PAYMENTS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-ink-2">Order
                <input type="search" name="q" defaultValue={filter.q} placeholder="#OV3119…" maxLength={40} className="w-40 rounded-md border border-line bg-raised px-3 py-2 text-ink" />
              </label>
              <button type="submit" className="rounded-md bg-ink px-4 py-2 font-semibold text-ground">Apply</button>
              {filtered ? <Link href={link({ status: null, pay: null, q: null })} className="px-2 py-2 text-ink-2 hover:text-ink">Clear</Link> : null}
              <span className="ml-auto self-center text-ink-3">{filtered ? `${shown.length} of ${rows.length} listed` : `${rows.length} listed, cancelled included`}</span>
            </form>
            <div className="mt-4"><OrdersTable rows={shown} storeName={storeName} /></div>

            <div className="mt-10 grid items-start gap-6 lg:grid-cols-2">
              {view.store === 'all' ? (
                <RatesTable title="Delivery rate by store" by="Store" rows={deliveryRates(rows, (o) => storeName(o.storeId))}
                  note="Delivered ÷ (delivered + RTO) among this month's orders. Unknown payment counts in All only." />
              ) : null}
              <RatesTable title="Delivery rate by state" by="State" rows={deliveryRates(rows, (o) => o.state ?? 'Not known')}
                note="Same measure, by ship-to state. Small counts swing: read the n under each rate." />
            </div>
          </>
        )}
      </main>
    </>
  )
}
