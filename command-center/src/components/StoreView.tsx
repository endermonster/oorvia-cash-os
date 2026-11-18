import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { fmtX, inr, MIN_SAMPLE, pct, type Metrics, type Period, type Rate, type StoreStats } from '@/lib/metrics'
import { href, type ViewState } from '@/lib/nav'
import type { OrderDay, ProductStage, StoreId } from '@/lib/types'
import { PaceChart } from './PaceChart'
import { Delta, Headline, Signed, StoreDot } from './bits'

const STAGE: Record<ProductStage, { label: string; tone: string }> = {
  testing: { label: 'Testing', tone: 'text-ink-3' },
  live: { label: 'Live', tone: 'text-good' },
  out_of_stock: { label: 'Out of stock', tone: 'text-warn' },
  failed: { label: 'Failed', tone: 'text-bad' },
}

export function StoreView({ id, view, period, m, orders }: { id: StoreId; view: ViewState; period: Period; m: Metrics; orders: OrderDay[] }) {
  const s = m.storeStats(id, period)
  const store = m.storeById(id)
  const products = m.relevantProducts(id, period)
  const pts = m.series([id], period)
  const camps = m.campaigns(id, period)
  const warnings = [
    ...s.unknownSkus.map((sku) => `Orders for SKU ${sku} have no product set up: add it to see breakeven`),
    ...products.filter((p) => p.cogs === null).map((p) => `No cost on record for SKU ${p.sku}`),
    ...(s.ordersMissingCogs > 0 ? [`${s.ordersMissingCogs} ${s.ordersMissingCogs === 1 ? 'order has a line' : 'orders have a line'} with no cost on record: profit is overstated`] : []),
  ]

  return (
    <main className="mx-auto max-w-[1440px] px-4 pb-16 sm:px-8 lg:px-10">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-8">
        <h1 className="flex items-center gap-3 text-2xl font-extrabold tracking-tight text-ink"><StoreDot id={id} size={12} />{store.name}</h1>
        <p className="text-ink-2">{products.map((p) => <span key={p.sku}>{p.name} {inr(p.price)} <span className={`text-sm font-semibold ${STAGE[p.stage].tone}`}>{STAGE[p.stage].label}</span> · </span>)}store live since {new Date(`${store.liveSince}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</p>
      </div>

      <section className="mt-8 max-w-[880px]" aria-label="Revenue and ad spend">
        <Headline
          short={period.short} scope={store.name} prevLabel={period.prevLabel}
          revenue={s.revenue} prevRevenue={s.prev.revenue} spend={s.spend} prevSpend={s.prev.spend}
        />
        <p className="mt-6 text-ink-2">
          {s.orders} orders · profit (est.) <Signed value={s.contribution} className="font-semibold text-ink" />
          {s.unmappedSpend > 0 && <> · <span className="text-warn">{inr(s.unmappedSpend)} spend whose ad URL matches no product, check the handle</span></>}
        </p>
        {warnings.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm text-warn">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        )}
      </section>

      <div className="mt-14 grid gap-x-12 gap-y-10 border-t border-line pt-10 lg:grid-cols-12">
        <section className="lg:col-span-6" aria-labelledby="roas-h">
          <h2 id="roas-h" className="label">ROAS · {period.short} · Meta (incl. GST)</h2>
          {s.roas === null ? (
            <div className="mt-6 rounded-xl bg-raised p-8">
              <p className="text-xl font-semibold text-ink">No ads ran in this period.</p>
              <p className="mt-2 text-ink-2">{s.orders} organic {s.orders === 1 ? 'order' : 'orders'} · {inr(s.revenue)} booked. {s.economics ? <>Breakeven for {s.economics.weightedNames.join(', ')} is {fmtX(s.economics.breakevenRoas)}; your target is {fmtX(s.economics.targetRoas)}.</> : 'Breakeven needs a product cost.'}</p>
            </div>
          ) : (
            <Gauge s={s} />
          )}
        </section>

        <section className="lg:col-span-6" aria-label="Meta numbers">
          <dl className="grid gap-px overflow-hidden rounded-xl bg-line sm:grid-cols-3">
            <Stat label="CPA" value={s.cpa ? inr(s.cpa) : '—'} sub={<span className="text-sm text-ink-3">{s.economics ? `breakeven ${inr(s.economics.breakevenCpa)} per order` : 'Breakeven needs a product cost'}</span>} />
            <Stat label="CPM" value={s.cpm ? inr(s.cpm) : '—'} sub={s.cpm && s.prev.cpm ? <Delta now={s.cpm} prev={s.prev.cpm} goodWhenUp={false} suffix={`vs ${period.prevLabel}`} /> : null} />
            <Stat label="CTR" value={s.ctr ? pct(s.ctr, 1) : '—'} sub={<span className="text-sm text-ink-3">{s.clicks.toLocaleString('en-IN')} link clicks</span>} />
          </dl>
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
                const over = (c.vsBreakeven !== null && c.vsBreakeven > 1) || c.noSalesLoss
                return (
                  <li key={c.id} className="py-3">
                    <p className="font-semibold text-ink">{c.name}</p>
                    <p className="mt-0.5 text-sm text-ink-2">
                      {inr(c.spend)} · {c.orders} orders · CPA <span className={over ? 'font-semibold text-bad' : 'font-semibold text-ink'}>{c.cpa ? inr(c.cpa) : '—'}</span>
                      {c.noSalesLoss ? <span className="text-bad"> · {inr(c.spend)} spent, no orders</span> : over && <span className="text-bad"> · over breakeven CPA</span>}
                      {c.sku === null && <span className="text-warn"> · URL matches no product</span>}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <OrdersStrip s={s} period={period} m={m} orders={orders} />
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
  if (s.economics === null) {
    return (
      <div className="mt-4 rounded-xl bg-raised p-8">
        <p className="text-5xl font-extrabold tracking-tight text-ink">{fmtX(roas)}</p>
        <p className="mt-2 text-ink-2">{s.orders} orders · {inr(s.spend)} spent · Breakeven needs a product cost</p>
      </div>
    )
  }
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

function OrdersStrip({ s, period, m, orders }: { s: StoreStats; period: Period; m: Metrics; orders: OrderDay[] }) {
  const store = s.store
  const rows = orders.filter((r) => r.storeId === store.id && r.date >= period.from && r.date <= period.to)
  const dots: ('cod' | 'prepaid')[] = []
  for (const r of rows) {
    for (let i = 0; i < r.orders; i++) dots.push(r.payment)
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
      {m.relevantProducts(store.id, period).map((p, _, all) => {
        const share = m.codShare(p.storeId, p.sku)
        return (
          <div key={p.sku} className="mt-8">
            {all.length > 1 && <h3 className="mb-3 font-semibold text-ink">{p.name}</h3>}
            <dl className="grid gap-x-12 gap-y-6 sm:grid-cols-3">
              <div>
                <dt className="label">COD share · last 30 days</dt>
                <dd className="mt-1 text-2xl font-extrabold text-ink">{pct(share.value)}</dd>
                <dd className="mt-1 text-sm text-ink-3">{basisNote(share, store.name, 'orders')}</dd>
              </div>
              {(['cod', 'prepaid'] as const).map((pay) => {
                const week = m.deliveryRate(p.storeId, p.sku, pay, '7d')
                const life = m.deliveryRate(p.storeId, p.sku, pay, 'lifetime')
                const rate = m.deliveryRate(p.storeId, p.sku, pay)
                // Shown for reading only; no math uses them, so a borrowed rate would just mislead.
                const own = (r: Rate) => (r.basis === 'sku' ? pct(r.value, 1) : `under ${MIN_SAMPLE} closed`)
                return (
                  <div key={pay}>
                    <dt className="label">Delivered · {pay === 'cod' ? 'COD' : 'Prepaid'} · last 30 days</dt>
                    <dd className="mt-1 text-2xl font-extrabold text-ink">{pct(rate.value, 1)}</dd>
                    <dd className="mt-1 text-sm text-ink-3">{basisNote(rate, store.name, 'closed orders')}</dd>
                    <dd className="mt-1 text-sm text-ink-2">7 days {own(week)} · lifetime {own(life)}</dd>
                  </div>
                )
              })}
            </dl>
          </div>
        )
      })}
    </section>
  )
}

/** Where a rate came from, in plain words. */
function basisNote(r: Rate, storeName: string, unit: string) {
  switch (r.basis) {
    case 'sku': return `${r.n} ${unit}`
    case 'store': return `${storeName} average · ${r.n} ${unit}`
    case 'vxp': return `VXP average · ${storeName} has under ${MIN_SAMPLE} ${unit} yet`
    default: return 'Pricing sheet default · no history yet'
  }
}
