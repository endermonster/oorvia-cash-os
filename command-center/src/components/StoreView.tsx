import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { campaigns, fmtX, inr, pct, series, storeStats, type Period, type StoreStats } from '@/lib/metrics'
import { DAILY, storeById } from '@/lib/mock'
import { href, type ViewState } from '@/lib/nav'
import type { StoreId } from '@/lib/types'
import { PaceChart } from './PaceChart'
import { Delta, Signed, StoreDot } from './bits'

export function StoreView({ id, view, period }: { id: StoreId; view: ViewState; period: Period }) {
  const s = storeStats(id, period)
  const store = storeById(id)
  const pts = series([id], period)
  const camps = campaigns(id, period)

  return (
    <main className="mx-auto max-w-[1440px] px-4 pb-16 sm:px-8 lg:px-10">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-8">
        <h1 className="flex items-center gap-3 text-2xl font-extrabold tracking-tight text-ink"><StoreDot id={id} size={12} />{store.name}</h1>
        <p className="text-ink-2">{store.product.name} · {inr(store.product.price)} · live since {new Date(`${store.liveSince}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</p>
      </div>

      <div className="mt-8 grid gap-x-12 gap-y-10 lg:grid-cols-12">
        <section className="lg:col-span-6" aria-labelledby="roas-h">
          <h2 id="roas-h" className="label">ROAS · {period.short} · Meta (incl. GST)</h2>
          {s.roas === null ? (
            <div className="mt-6 rounded-xl bg-raised p-8">
              <p className="text-xl font-semibold text-ink">No ads ran in this period.</p>
              <p className="mt-2 text-ink-2">{s.orders} organic {s.orders === 1 ? 'order' : 'orders'} · {inr(s.revenue)} booked. Breakeven for {store.product.name} is {fmtX(s.economics.breakevenRoas)}; your target is {fmtX(s.economics.targetRoas)}.</p>
            </div>
          ) : (
            <Gauge s={s} />
          )}
        </section>

        <section className="lg:col-span-6" aria-label="Meta numbers">
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line">
            <Stat label={`Spend · ${period.short} · Meta`} value={inr(s.spend)} sub={<Delta now={s.spend} prev={s.prev.spend} neutral suffix={`vs ${period.prevLabel}`} />} />
            <Stat label="CPA" value={s.cpa ? inr(s.cpa) : '—'} sub={<span className="text-sm text-ink-3">breakeven {inr(s.economics.breakevenCpa)} per order</span>} />
            <Stat label="CPM" value={s.cpm ? inr(s.cpm) : '—'} sub={s.cpm && s.prev.cpm ? <Delta now={s.cpm} prev={s.prev.cpm} goodWhenUp={false} suffix={`vs ${period.prevLabel}`} /> : null} />
            <Stat label="CTR" value={s.ctr ? pct(s.ctr, 1) : '—'} sub={<span className="text-sm text-ink-3">{s.clicks.toLocaleString('en-IN')} link clicks</span>} />
          </dl>
          <p className="mt-4 text-sm text-ink-3">
            Profit (estimate) <Signed value={s.contribution} className="font-semibold text-ink" /> · realised so far <Signed value={s.realised} className="text-ink-2" />
          </p>
        </section>
      </div>

      <div className="mt-14 grid gap-x-12 gap-y-10 border-t border-line pt-10 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          <PaceChart points={pts} title={`Pace · ${period.range}`} prevLabel={period.prevLabel} unit={period.id === 'today' ? 'hour' : 'day'} />
        </div>
        <section className="lg:col-span-4" aria-labelledby="camp-h">
          <div className="flex items-baseline justify-between">
            <h2 id="camp-h" className="text-base font-semibold text-ink">Campaigns</h2>
            <Link href={href('/ads', view)} className="inline-flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink">All campaigns <ArrowRight className="size-4" aria-hidden /></Link>
          </div>
          {camps.length === 0 ? (
            <p className="mt-4 text-ink-3">No campaigns spent in this period.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {camps.sort((a, b) => b.spend - a.spend).map((c) => {
                const over = c.vsBreakeven !== null && c.vsBreakeven > 1
                return (
                  <li key={c.id} className="py-3">
                    <p className="font-semibold text-ink">{c.name}</p>
                    <p className="mt-0.5 text-sm text-ink-2">
                      {inr(c.spend)} · {c.orders} orders · CPA <span className={over ? 'font-semibold text-bad' : 'font-semibold text-ink'}>{c.cpa ? inr(c.cpa) : '—'}</span>
                      {over && <span className="text-bad"> · over breakeven CPA</span>}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <OrdersStrip s={s} period={period} />
    </main>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="bg-ground p-6">
      <dt className="label">{label}</dt>
      <dd className="mt-2 text-4xl font-extrabold tracking-tight text-ink">{value}</dd>
      <dd className="mt-1.5 min-h-5">{sub}</dd>
    </div>
  )
}

/** Semicircle with three zones on Meta's scale: below breakeven, covering costs, above target. */
function Gauge({ s }: { s: StoreStats }) {
  const roas = s.roas!
  const { breakevenRoas: be, targetRoas: target } = s.economics
  const max = Math.ceil(Math.max(target * 1.25, roas * 1.1))
  const W = 420, H = 240, cx = W / 2, cy = 214, r = 172
  const ang = (v: number) => Math.PI * (1 - Math.min(v, max) / max)
  const pt = (v: number, rad = r) => [cx + rad * Math.cos(ang(v)), cy - rad * Math.sin(ang(v))] as const
  const arc = (a: number, b: number) => {
    const [x1, y1] = pt(a), [x2, y2] = pt(b)
    return `M${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2}`
  }
  const [nx, ny] = pt(roas, r - 22)
  const [bx, by] = pt(roas, r - 62)
  const zone = s.zone!
  const word = zone === 'below' ? 'Below breakeven' : zone === 'covering' ? 'Covering costs' : 'Above your target'
  const tone = zone === 'below' ? 'text-bad' : zone === 'covering' ? 'text-warn' : 'text-good'
  const tick = (v: number, text: string, strong: boolean) => {
    const [x1, y1] = pt(v, r - 16), [x2, y2] = pt(v, r + 14), [tx, ty] = pt(v, r + 30)
    return (
      <g>
        <line x1={x1} y1={y1} x2={x2} y2={y2} className={strong ? 'stroke-ink' : 'stroke-ink-2'} strokeWidth={2} />
        <text x={tx} y={ty} textAnchor="middle" dy="0.3em" className="fill-ink-2 text-[12px] font-semibold">{text}</text>
      </g>
    )
  }
  return (
    <div className="mt-4">
      <svg viewBox={`0 -24 ${W} ${H + 24}`} className="w-full max-w-[460px]" role="img" aria-label={`ROAS ${fmtX(roas)}. Breakeven ${fmtX(be)}, target ${fmtX(target)}. ${word}.`}>
        <path d={arc(0, be)} fill="none" className="stroke-bad/55" strokeWidth={14} />
        <path d={arc(be, target)} fill="none" className="stroke-warn/55" strokeWidth={14} />
        <path d={arc(target, max)} fill="none" className="stroke-good/55" strokeWidth={14} />
        {tick(be, `BE ${be.toFixed(2)}`, false)}
        {tick(target, `Target ${target.toFixed(2)}`, true)}
        <line x1={bx} y1={by} x2={nx} y2={ny} className="stroke-ink" strokeWidth={4} strokeLinecap="round" />
        <circle cx={nx} cy={ny} r={5} className="fill-ink" />
        <text x={cx} y={cy - 8} textAnchor="middle" className="fill-ink text-[68px] font-extrabold" letterSpacing="-0.04em">{fmtX(roas)}</text>
      </svg>
      <p className={`mt-2 text-lg font-semibold ${tone}`}>{word}</p>
      <p className="mt-1 text-ink-2">
        {s.orders} orders · {inr(s.spend)} spent · breakeven {fmtX(be)}, target {fmtX(target)}
        {zone === 'covering' && <> · {fmtX(target - roas)} short of target</>}
      </p>
    </div>
  )
}

function OrdersStrip({ s, period }: { s: StoreStats; period: Period }) {
  const store = s.store
  const rows = DAILY.filter((r) => r.storeId === store.id && r.date >= period.from && r.date <= period.to)
  const dots: ('cod' | 'prepaid')[] = []
  for (const r of rows) {
    for (let i = 0; i < r.orders; i++) dots.push(i < r.codOrders ? 'cod' : 'prepaid')
  }
  const shown = dots.slice(0, 120)
  return (
    <section aria-labelledby="dots-h" className="mt-14 border-t border-line pt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 id="dots-h" className="text-base font-semibold text-ink">Orders · {period.short} · {s.orders}</h2>
        <ul className="flex gap-5 text-sm text-ink-2" aria-label="Legend">
          <li className="flex items-center gap-2"><span className="size-2.5 rounded-[3px] bg-prepaid" />Prepaid {s.orders - s.codOrders}</li>
          <li className="flex items-center gap-2"><span className="size-2.5 rounded-[3px] bg-cod" />COD {s.codOrders}</li>
        </ul>
      </div>
      {shown.length === 0 ? (
        <p className="mt-4 text-ink-3">No orders in this period.</p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-1.5" role="img" aria-label={`${s.orders - s.codOrders} prepaid and ${s.codOrders} COD orders`}>
          {shown.map((d, i) => <span key={i} className={`size-3.5 rounded-[4px] ${d === 'cod' ? 'bg-cod' : 'bg-prepaid'}`} />)}
          {dots.length > shown.length && <span className="ml-2 self-center text-sm text-ink-3">+{dots.length - shown.length} more</span>}
        </div>
      )}
      <dl className="mt-8 grid gap-x-12 gap-y-6 sm:grid-cols-3">
        <div>
          <dt className="label">COD share</dt>
          <dd className="mt-1 text-2xl font-extrabold text-ink">{s.orders ? pct(s.codOrders / s.orders) : '—'}</dd>
        </div>
        <div>
          <dt className="label">Delivery rate</dt>
          <dd className="mt-1 text-2xl font-extrabold text-ink">{pct(store.deliveryRate.value, 1)}</dd>
          <dd className="mt-1 text-sm text-ink-3">{store.deliveryRate.assumedFrom ? `Assumed from ${storeById(store.deliveryRate.assumedFrom).name}: no ${store.name} history yet` : 'From vFulfill shipments, since March'}</dd>
        </div>
        <div>
          <dt className="label">RTO</dt>
          <dd className="mt-1 text-2xl font-extrabold text-ink">{store.deliveryRate.assumedFrom ? '—' : pct(1 - store.deliveryRate.value, 1)}</dd>
          <dd className="mt-1 text-sm text-ink-3">{store.deliveryRate.assumedFrom ? 'Appears once orders resolve' : 'Share of resolved orders returned'}</dd>
        </div>
      </dl>
    </section>
  )
}
