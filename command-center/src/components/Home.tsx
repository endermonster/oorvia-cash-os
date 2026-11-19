import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { breaksEven, noBreakevenText } from '@/lib/calculator'
import { fmtX, inr, MIN_SAMPLE, pct, type Metrics, type Period, type Portfolio, type StoreStats } from '@/lib/metrics'
import { href, type ViewState } from '@/lib/nav'
import type { StoreId } from '@/lib/types'
import { Calls } from './Calls'
import { PaceChart } from './PaceChart'
import { Headline, Signed, StoreDot } from './bits'

export function HomeView({ view, period, m }: { view: ViewState; period: Period; m: Metrics }) {
  const pf = m.portfolio(period)
  const ids = m.stores.map((s) => s.id)
  const pts = m.series(ids, period)
  const c = m.cash()
  const g = m.gst()
  const share = m.ownerShare()
  const borrowed = m.borrowedRates(undefined, period).map((s) => s.name)
  const missing = missingCosts(pf.stores)

  return (
    <main className="mx-auto max-w-[1440px] px-4 pb-16 sm:px-8 lg:px-10">
      <div className="grid gap-x-12 gap-y-10 pt-10 lg:grid-cols-12">
        <section className="lg:col-span-7" aria-label="Revenue and ad spend">
          <Headline
            short={period.short} scope="all stores" prevLabel={period.prevLabel}
            revenue={pf.total.revenue} prevRevenue={pf.total.prevRevenue} spend={pf.total.spend} prevSpend={pf.total.prevSpend}
          />
          <p className="mt-8 text-ink-2">
            {pf.total.orders} orders · {pf.total.roas !== null ? `${fmtX(pf.total.roas)} blended ROAS` : 'no ads'} · profit (est.) <Signed value={pf.total.contribution} className="font-semibold text-ink" />
          </p>
          {missing && <p className="mt-2 max-w-[70ch] text-sm text-warn">{missing}</p>}
          <p className="mt-2 max-w-[70ch] text-sm text-ink-3">
            {verdict(pf.stores, m.metaNotConnected)} Profit uses each product’s own delivery rate, COD and prepaid separately
            {borrowed.length > 0 && <>; {borrowed.join(' and ')} {borrowed.length === 1 ? 'uses' : 'use'} VXP rates until {MIN_SAMPLE} orders resolve</>}.
          </p>
        </section>

        <div className="lg:col-span-5">
          <Calls calls={m.calls(period)} />
        </div>
      </div>

      <div className="mt-14 grid gap-x-12 gap-y-10 border-t border-line pt-10 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          <PaceChart points={pts} title={`Pace · ${period.range}`} prevLabel={period.prevLabel} unit={period.id === 'today' ? 'hour' : 'day'} />
        </div>
        <div className="lg:col-span-4">
          <LiveOrders view={view} m={m} />
        </div>
      </div>

      <Scoreboard stores={pf.stores} total={pf.total} view={view} notConnected={m.metaNotConnected} />

      <p className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-6 text-sm text-ink-2">
        {c && g && share ? (
          <>
            <span>Cash <span className="font-semibold text-ink">{inr(c.total)}</span>{c.coversDays !== null && <> · covers {Math.floor(c.coversDays)} days of spend</>}</span>
            <span aria-hidden className="text-ink-3">·</span>
            <span>GST {new Date(`${g.month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' })} <span className="font-semibold text-ink">{inr(g.owed)}</span> due {new Date(`${g.dueDate}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>
            <span aria-hidden className="text-ink-3">·</span>
            <span>Your share (50%) this month <Signed value={share.share} className="font-semibold text-ink" /></span>
          </>
        ) : (
          <span className="text-ink-3">Cash, GST and your share connect in a later stage</span>
        )}
        <Link href={href('/money', view)} className="ml-auto inline-flex items-center gap-1 font-semibold text-ink hover:underline">
          Money <ArrowRight className="size-4" aria-hidden />
        </Link>
      </p>
    </main>
  )
}

/** The store page's "no cost on record" warning, for every store at once; null when every order line has a cost. */
export function missingCosts(stores: StoreStats[]): string | null {
  const hit = stores.filter((s) => s.ordersMissingCogs > 0)
  if (hit.length === 0) return null
  const parts = hit.map((s) => `${s.store.name} ${s.ordersMissingCogs} ${s.ordersMissingCogs === 1 ? 'order' : 'orders'}`)
  return `Profit is overstated: ${parts.join(', ')} with a line that has no cost on record.`
}

/** One plain sentence about which stores are paying for their ads. A store with uncosted orders only "looks" like it is. */
export function verdict(stores: StoreStats[], notConnected: (id: StoreId) => boolean): string {
  const withAds = stores.filter((s) => s.spend > 0)
  if (withAds.length === 0) return stores.some((s) => notConnected(s.store.id)) ? 'No ad data: Meta is not connected for some stores.' : 'No ads ran in this period.'
  const unsure = withAds.filter((s) => s.contribution >= 0 && s.ordersMissingCogs > 0)
  if (unsure.length > 0) {
    const others = withAds.filter((s) => !unsure.includes(s))
    const names = unsure.map((s) => s.store.name)
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    return `${who} ${names.length === 1 ? 'looks' : 'look'} profitable, but costs are missing.${others.length > 0 ? ` ${verdict(others, notConnected)}` : ''}`
  }
  const paying = withAds.filter((s) => s.contribution >= 0).map((s) => s.store.name)
  const losing = withAds.filter((s) => s.contribution < 0).map((s) => s.store.name)
  const list = (n: string[]) => (n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`)
  if (losing.length === 0) return `${list(paying)} ${paying.length === 1 ? 'is' : 'are'} paying for ${paying.length === 1 ? 'itself' : 'themselves'}.`
  if (paying.length === 0) return `${list(losing)} ${losing.length === 1 ? 'isn’t' : 'aren’t'} covering ad spend yet.`
  return `${list(paying)} ${paying.length === 1 ? 'is' : 'are'} paying for ${paying.length === 1 ? 'itself' : 'themselves'}. ${list(losing)} ${losing.length === 1 ? 'isn’t' : 'aren’t'}, yet.`
}

function LiveOrders({ view, m }: { view: ViewState; m: Metrics }) {
  const orders = m.recentOrders(m.stores.map((s) => s.id), 5)
  return (
    <section aria-labelledby="orders-h">
      <div className="flex items-baseline justify-between">
        <h2 id="orders-h" className="text-base font-semibold text-ink">Latest orders</h2>
        <Link href={href('/orders', view)} className="inline-flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink">
          All orders <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
      {orders.length === 0 ? (
        <p className="mt-4 text-ink-3">No orders yet today.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {orders.map((o) => (
            <li key={o.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-semibold text-ink"><StoreDot id={o.storeId} />{m.storeById(o.storeId).name}<span className="truncate font-normal text-ink-3">· {o.city}</span></p>
                <p className="mt-0.5 truncate text-sm text-ink-2">{o.product}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-ink">{inr(o.value)}</p>
                <p className="mt-0.5 text-sm">
                  <span className={o.payment === 'cod' ? 'text-cod' : o.payment === 'prepaid' ? 'text-prepaid' : 'text-ink-3'}>{o.payment === 'cod' ? 'COD' : o.payment === 'prepaid' ? 'Prepaid' : 'Payment unknown'}</span>
                  <span className="text-ink-3"> · {ago(m.minutesAgo(o.placedAt))}</span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const ago = (m: number) => (m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`)

function RoasBar({ s, off }: { s: StoreStats; off: boolean }) {
  if (s.roas === null) return <span className="text-sm text-ink-3">{off ? 'Meta not connected' : 'No ads'}</span>
  if (s.economics === null) {
    return (
      <div className="min-w-48">
        <p className="text-sm"><span className="font-semibold text-ink">{fmtX(s.roas)}</span></p>
        <p className="mt-1.5 text-xs text-warn">Breakeven needs a product cost</p>
      </div>
    )
  }
  if (!breaksEven(s.economics)) {
    return (
      <div className="min-w-48">
        <p className="text-sm"><span className="font-semibold text-ink">{fmtX(s.roas)}</span><span className="text-ink-3"> · Below breakeven</span></p>
        <p className="mt-1.5 text-xs text-bad">{noBreakevenText(s.economics)}</p>
      </div>
    )
  }
  const { breakevenRoas: be, targetRoas: target } = s.economics
  const max = Math.max(target * 1.15, s.roas * 1.05)
  const at = (v: number) => `${(v / max) * 100}%`
  const tone = s.zone === 'below' ? 'bg-bad' : s.zone === 'covering' ? 'bg-warn' : 'bg-good'
  const word = s.zone === 'below' ? 'Below breakeven' : s.zone === 'covering' ? 'Covering costs' : 'Above target'
  return (
    <div className="min-w-48">
      <p className="text-sm">
        <span className="font-semibold text-ink">{fmtX(s.roas)}</span>
        <span className="text-ink-3"> · {word}</span>
      </p>
      <div className="relative mt-2 h-1.5 rounded-full bg-line-strong" title={`Breakeven ${fmtX(be)} · target ${fmtX(target)}`}>
        <div className={`absolute inset-y-0 left-0 rounded-full ${tone}`} style={{ width: at(s.roas) }} />
        <span className="absolute -top-1 h-3.5 w-0.5 rounded bg-ink-2" style={{ left: at(be) }} aria-hidden />
        <span className="absolute -top-1 h-3.5 w-0.5 rounded bg-ink" style={{ left: at(target) }} aria-hidden />
      </div>
      <p className="mt-1.5 text-xs text-ink-3">breakeven {fmtX(be)} · target {fmtX(target)}</p>
    </div>
  )
}

function Scoreboard({ stores, total, view, notConnected }: { stores: StoreStats[]; total: Portfolio['total']; view: ViewState; notConnected: (id: StoreId) => boolean }) {
  const th = 'pb-3 text-left font-semibold label'
  return (
    <section aria-labelledby="score-h" className="mt-14 border-t border-line pt-10">
      <h2 id="score-h" className="text-base font-semibold text-ink">Stores</h2>
      <ul className="mt-4 divide-y divide-line border-y border-line md:hidden">
        {stores.map((s) => (
          <li key={s.store.id} className="py-4">
            <Link href={href('/', { ...view, store: s.store.id })} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-3 font-semibold text-ink"><StoreDot id={s.store.id} size={10} />{s.store.name}</span>
              <span className="font-semibold text-ink"><Signed value={s.contribution} /> <span className="text-xs font-normal text-ink-3">profit est.</span></span>
            </Link>
            <p className="mt-1 text-sm text-ink-2">{inr(s.spend)} spend · {s.orders} orders · {inr(s.revenue)} booked</p>
            <div className="mt-3"><RoasBar s={s} off={notConnected(s.store.id)} /></div>
          </li>
        ))}
        <li className="flex items-center justify-between py-4 font-extrabold text-ink">
          <span>VXP total</span><Signed value={total.contribution} />
        </li>
      </ul>
      <div className="mt-4 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>Store</th>
              <th className={`${th} text-right`}>Spend</th>
              <th className={`${th} text-right`}>Orders</th>
              <th className={`${th} pl-10`}>ROAS</th>
              <th className={`${th} text-right`}>Booked revenue</th>
              <th className={`${th} text-right`}>Profit (est.)</th>
            </tr>
          </thead>
          <tbody>
            {stores.map((s) => (
              <tr key={s.store.id} className="group border-b border-line">
                <td className="py-4">
                  <Link href={href('/', { ...view, store: s.store.id })} className="flex items-center gap-3 font-semibold text-ink group-hover:underline">
                    <StoreDot id={s.store.id} size={10} />{s.store.name}
                  </Link>
                </td>
                <td className="py-4 text-right text-ink">{inr(s.spend)}</td>
                <td className="py-4 text-right text-ink">{s.orders}<span className="block text-xs text-ink-3">{s.orders ? `${pct(s.codOrders / s.orders)} COD` : '—'}</span></td>
                <td className="py-4 pl-10"><RoasBar s={s} off={notConnected(s.store.id)} /></td>
                <td className="py-4 text-right text-ink">{inr(s.revenue)}</td>
                <td className="py-4 text-right font-semibold text-ink"><Signed value={s.contribution} /></td>
              </tr>
            ))}
            <tr>
              <td className="pt-4 font-extrabold text-ink">VXP total</td>
              <td className="pt-4 text-right font-extrabold text-ink">{inr(total.spend)}</td>
              <td className="pt-4 text-right font-extrabold text-ink">{total.orders}</td>
              <td className="pt-4 pl-10 text-sm text-ink-3">{total.roas !== null ? `${fmtX(total.roas)} blended` : '—'}</td>
              <td className="pt-4 text-right font-extrabold text-ink">{inr(total.revenue)}</td>
              <td className="pt-4 text-right font-extrabold text-ink"><Signed value={total.contribution} /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}
