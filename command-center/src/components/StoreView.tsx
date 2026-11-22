import Link from 'next/link'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { breaksEven, noBreakevenText } from '@/lib/calculator'
import { fmtX, inr, MIN_SAMPLE, pct, type Closed, type DeliveryRow, type Metrics, type Period, type Rate, type StoreStats } from '@/lib/metrics'
import { href, type ViewState } from '@/lib/nav'
import type { OrderDay, OrderPayment, ProductStage, StoreId } from '@/lib/types'
import { codShareLabel, verdict } from './Home'
import { PaceChart } from './PaceChart'
import { RoasTrack } from './RoasTrack'
import { Delta, Signed, StoreDot, tone } from './bits'

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
  const camps = [...m.campaigns(id, period)].sort((a, b) => b.spend - a.spend)
  const off = m.metaNotConnected(id)
  // Profit-affecting warnings first, so they survive the 3-line cut.
  const warnings = [
    ...(s.ordersMissingCogs > 0 ? [`${s.ordersMissingCogs} ${s.ordersMissingCogs === 1 ? 'order has a line' : 'orders have a line'} with no cost on record: profit is overstated`] : []),
    ...(s.unmappedSpend > 0 ? [`${inr(s.unmappedSpend)} spend whose ad URL matches no product, check the handle`] : []),
    ...s.unknownSkus.map((sku) => `Orders for SKU ${sku} have no product set up: add it to see breakeven`),
    ...products.filter((p) => p.cogs === null).map((p) => `No cost on record for SKU ${p.sku}`),
  ]
  const e = s.economics
  const liveSince = new Date(`${store.liveSince}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const src = (metric: string, from: string) => `${metric} · ${period.short} · ${from}`
  const stats: { k: string; label: string; value: string; sub: React.ReactNode }[] = [
    { k: 'rev', label: src('Revenue', 'Shopify'), value: inr(s.revenue), sub: <Delta now={s.revenue} prev={s.prev.revenue} suffix={`vs ${period.prevLabel}`} /> },
    { k: 'spend', label: src('Spend', 'Meta'), value: inr(s.spend), sub: <Delta now={s.spend} prev={s.prev.spend} neutral suffix={`vs ${period.prevLabel}`} /> },
    { k: 'orders', label: src('Orders', 'Shopify'), value: String(s.orders), sub: codShareLabel(s) ? <span className="text-sm text-ink-2">{codShareLabel(s)}</span> : null },
    { k: 'cpa', label: src('CPA', 'Meta'), value: s.cpa ? inr(s.cpa) : '—', sub: <span className="text-sm text-ink-3">{e === null ? 'Breakeven needs a product cost' : breaksEven(e) ? `breakeven ${inr(e.breakevenCpa)} per order` : `loses ${inr(-e.breakevenCpa)} per order before ads`}</span> },
    { k: 'cpm', label: src('CPM', 'Meta'), value: s.cpm ? inr(s.cpm) : '—', sub: s.cpm && s.prev.cpm ? <Delta now={s.cpm} prev={s.prev.cpm} goodWhenUp={false} suffix={`vs ${period.prevLabel}`} /> : null },
    { k: 'ctr', label: src('CTR', 'Meta'), value: s.ctr ? pct(s.ctr, 1) : '—', sub: <span className="text-sm text-ink-3">{s.clicks.toLocaleString('en-IN')} link clicks</span> },
  ]

  return (
    <main className="mx-auto max-w-[1536px] space-y-3 px-3 pb-6 pt-3 sm:px-4">
      <section aria-label="Verdict" className="glass rise grid gap-x-8 gap-y-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,auto)_auto]">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2.5 text-[1.6rem] font-bold tracking-[-0.02em]"><StoreDot id={id} size={11} /><span className="truncate">{store.name}</span></p>
            <CallChip s={s} off={off} />
          </div>
          <h1 className="mt-2 text-balance text-[clamp(1.5rem,2.2vw,2.1rem)] font-extrabold leading-[1.12] tracking-[-0.025em]">{verdict([s], m.metaNotConnected)}</h1>
          <p className="mt-2 text-sm text-ink-2">{products.map((p) => <span key={p.sku}>{p.name} {inr(p.price)} <span className={`font-semibold ${STAGE[p.stage].tone}`}>{STAGE[p.stage].label}</span> · </span>)}live since {liveSince}</p>
          {warnings.length > 0 && (
            <div className="mt-1 text-sm text-warn">
              <ul className="space-y-0.5">
                {warnings.slice(0, 3).map((w, i) => <li key={w} className="flex items-start gap-1.5">{i === 0 && <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}<span className={i === 0 ? '' : 'pl-[1.375rem]'}>{w}</span></li>)}
              </ul>
              {warnings.length > 3 && (
                <details className="mt-0.5 pl-[1.375rem]">
                  <summary className="cursor-pointer text-ink-3">+{warnings.length - 3} more</summary>
                  <ul className="mt-0.5 space-y-0.5">{warnings.slice(3).map((w) => <li key={w}>{w}</li>)}</ul>
                </details>
              )}
            </div>
          )}
        </div>

        <div className="border-line lg:border-l lg:pl-8">
          <p className="label">ROAS vs breakeven · {period.short} · Meta</p>
          <div className="mt-1">
            {s.roas === null ? (
              <>
                <p className="text-lg text-ink-2">{off ? 'Meta not connected' : 'No ads ran in this period.'}</p>
                <p className="text-sm text-ink-3">{s.orders} organic {s.orders === 1 ? 'order' : 'orders'} · {inr(s.revenue)} booked</p>
                {e === null ? <p className="text-xs text-warn">Breakeven needs a product cost</p>
                  : breaksEven(e) ? <p className="text-xs text-ink-2">Breakeven {fmtX(e.breakevenRoas)} · target {fmtX(e.targetRoas)}</p>
                  : <p className="text-xs text-bad">{noBreakevenText(e)}</p>}
              </>
            ) : e === null ? (
              <><p className="text-[1.3rem] font-bold text-revenue">{fmtX(s.roas)}</p><p className="text-xs text-warn">Breakeven needs a product cost</p></>
            ) : !breaksEven(e) ? (
              <><p className="text-[1.3rem] font-bold text-bad">{fmtX(s.roas)}</p><p className="text-xs text-bad">{noBreakevenText(e)}</p></>
            ) : (
              <>
                <RoasTrack roas={s.roas} be={e.breakevenRoas} target={e.targetRoas} zone={s.zone} />
                {s.zone === 'covering' && <p className="mt-1 text-xs text-ink-2">{fmtX(e.targetRoas - s.roas)} short of target</p>}
              </>
            )}
          </div>
        </div>

        <div className="border-line lg:border-l lg:pl-8">
          <p className="label">Profit (est.) · {period.short} · Estimate</p>
          <p className={`mt-1 text-[2.6rem] font-extrabold leading-none tracking-[-0.035em] ${tone(s.contribution)}`}>{s.contribution > 0 ? '+' : ''}<Signed value={s.contribution} /></p>
          {s.contribution < 0 && <p className="mt-1 text-xs text-bad">loss this period</p>}
          <p className="mt-1 text-sm text-ink-2">{s.orders} orders</p>
        </div>
      </section>

      <section aria-label="Key numbers" className="glass rise p-2 @container [--delay:80ms]">
        <dl className="grid grid-cols-2 @min-[44rem]:grid-cols-3 @min-[72rem]:grid-cols-6">
          {stats.map((c) => (
            <div key={c.k} className="min-w-0 border-line px-3 py-3 @min-[44rem]:border-l @min-[44rem]:nth-[3n+1]:border-l-0 @min-[72rem]:nth-[3n+1]:border-l @min-[72rem]:first:border-l-0">
              <dt className="label">{c.label}</dt>
              <dd className="mt-1 text-[1.3rem] font-bold leading-tight">{c.value}</dd>
              <dd className="mt-0.5 min-h-5">{c.sub}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Campaigns first in the DOM so phones read them before the chart; desktop puts them on the right. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-labelledby="camp-h" className="glass rise p-2 lg:col-start-2 lg:row-start-1 [--delay:120ms]">
          <div className="flex items-baseline justify-between gap-3 px-3 pt-2">
            <h2 id="camp-h" className="text-lg font-bold">Campaigns</h2>
            <Link href={href('/ads', view)} className="inline-flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink">All campaigns <ArrowRight className="size-4" aria-hidden /></Link>
          </div>
          {camps.length === 0 ? (
            <p className="px-3 pb-2 pt-3 text-ink-3">No campaigns spent in this period.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {camps.map((c) => {
                const over = (c.vsBreakeven !== null && c.vsBreakeven > 1) || c.noSalesLoss
                return (
                  <li key={c.id} className="glass-row px-3 py-2.5">
                    <p className="line-clamp-2 font-semibold text-ink">{c.name}</p>
                    <p className="mt-0.5 text-sm text-ink-2">{inr(c.spend)} · {c.orders} orders · CPA <span className={over ? 'font-semibold text-bad' : 'font-semibold text-ink'}>{c.cpa ? inr(c.cpa) : '—'}</span></p>
                    {c.noSalesLoss ? <p className="text-xs text-bad">{inr(c.spend)} spent, no orders</p> : over && <p className="text-xs text-bad">over breakeven CPA</p>}
                    {c.sku === null && <p className="text-xs text-warn">URL matches no product</p>}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
        <section aria-label="Pace" className="glass min-w-0 px-5 pb-3 pt-4 lg:col-start-1 lg:row-start-1">
          <PaceChart points={pts} title={`Pace · ${period.range}`} prevLabel={period.prevLabel} unit={period.id === 'today' ? 'hour' : 'day'} />
        </section>
      </div>

      <OrdersStrip s={s} period={period} m={m} orders={orders} />
      <DeliveryTable rows={m.deliveryTable(id)} />
    </main>
  )
}

/** One word per store, from where its ROAS sits against breakeven and target (same call as Home's row). */
function CallChip({ s, off }: { s: StoreStats; off: boolean }) {
  const [word, cls] =
    s.roas === null ? [off ? 'No data' : 'No ads', 'text-ink-2 ring-line-strong']
    : s.economics === null ? ['Add cost', 'text-warn ring-warn/40 bg-warn/10']
    : !breaksEven(s.economics) || s.zone === 'below' ? ['Cut or fix', 'text-bad ring-bad/45 bg-bad/12']
    : s.zone === 'profit' ? ['Scale', 'text-good ring-good/45 bg-good/12']
    : ['Hold', 'text-revenue ring-revenue/40 bg-revenue/10']
  return <span className={`inline-block min-w-[5.25rem] shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-center text-sm font-semibold ring-1 ${cls}`}>{word}</span>
}

function OrdersStrip({ s, period, m, orders }: { s: StoreStats; period: Period; m: Metrics; orders: OrderDay[] }) {
  const store = s.store
  const rows = orders.filter((r) => r.storeId === store.id && r.date >= period.from && r.date <= period.to)
  const dots: OrderPayment[] = []
  const prepaid = s.orders - s.codOrders - s.unknownPayOrders
  for (const r of rows) {
    for (let i = 0; i < r.orders; i++) dots.push(r.payment)
  }
  const shown = dots.slice(0, 120)
  return (
    <section aria-labelledby="dots-h" className="glass px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="dots-h" className="text-lg font-bold">Orders · {period.short} · {s.orders}</h2>
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2" aria-label="Legend">
          <li className="flex items-center gap-2"><span className="size-2.5 rounded-[3px] bg-prepaid" />Prepaid {prepaid}</li>
          <li className="flex items-center gap-2"><span className="size-2.5 rounded-[3px] bg-cod" />COD {s.codOrders}</li>
          {s.unknownPayOrders > 0 && <li className="flex items-center gap-2"><span className="size-2.5 rounded-[3px] bg-ink-3" />Payment unknown {s.unknownPayOrders}</li>}
        </ul>
      </div>
      {shown.length === 0 ? (
        <p className="mt-3 text-ink-3">No orders in this period.</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5" role="img" aria-label={`${prepaid} prepaid and ${s.codOrders} COD orders${s.unknownPayOrders ? `, ${s.unknownPayOrders} with payment unknown` : ''}`}>
          {shown.map((d, i) => <span key={i} className={`size-3.5 rounded-[4px] ${d === 'cod' ? 'bg-cod' : d === 'prepaid' ? 'bg-prepaid' : 'bg-ink-3'}`} />)}
          {dots.length > shown.length && <span className="ml-2 self-center text-sm text-ink-3">+{dots.length - shown.length} more</span>}
        </div>
      )}
      {m.relevantProducts(store.id, period).map((p, _, all) => {
        const share = m.codShare(p.storeId, p.sku)
        return (
          <div key={p.sku} className="mt-4 border-t border-line pt-4">
            {all.length > 1 && <h3 className="mb-3 font-semibold text-ink">{p.name}</h3>}
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="label">COD share · 30D</dt>
                <dd className="mt-1 text-[1.3rem] font-bold leading-tight">{pct(share.value)}</dd>
                <dd className="mt-1 text-sm text-ink-3">{basisNote(share, store.name, 'orders')}</dd>
              </div>
              {(['cod', 'prepaid'] as const).map((pay) => {
                const rate = m.deliveryRate(p.storeId, p.sku, pay)
                return (
                  <div key={pay}>
                    <dt className="label">Delivered · {pay === 'cod' ? 'COD' : 'Prepaid'} · 30D</dt>
                    <dd className="mt-1 text-[1.3rem] font-bold leading-tight">{pct(rate.value, 1)}</dd>
                    <dd className="mt-1 text-sm text-ink-3">{basisNote(rate, store.name, 'closed orders')}</dd>
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

const WINDOWS = [['7d', '7 days'], ['30d', '30 days'], ['lifetime', 'All time']] as const
const rateOf = (c: Closed) => { const n = c.delivered + c.rto; return n === 0 ? null : c.delivered / n }

/**
 * Delivered ÷ (delivered + RTO) per product, by the date the shipment closed: the store's own shipments only,
 * with the count beside each rate, so a rate from a handful of shipments reads as such.
 * Narrow panels (a 390 px phone) stack each product as a card with labelled values; no horizontal scroll.
 */
export function DeliveryTable({ rows }: { rows: DeliveryRow[] }) {
  const grid = '@min-[40rem]:grid @min-[40rem]:grid-cols-[minmax(8rem,1.4fr)_repeat(3,minmax(5rem,1fr))] @min-[40rem]:items-start @min-[40rem]:gap-x-3'
  return (
    <section aria-labelledby="delivery-h" className="glass p-2 @container">
      <h2 id="delivery-h" className="px-3 pt-2 text-lg font-bold">Delivery rate</h2>
      <p className="px-3 text-sm text-ink-3">Delivered ÷ (delivered + RTO), by the day the shipment closed. From vFulfill; payment type from Shopify.</p>
      {rows.length === 0 ? (
        <p className="px-3 pb-2 pt-3 text-ink-3">No shipments closed yet.</p>
      ) : (
        <div role="table" aria-label="Delivery rate" className="mt-3">
          <div role="row" className={`${grid} hidden px-3 pb-2`}>
            <span role="columnheader" className="label">Product</span>
            {WINDOWS.map(([w, label]) => <span key={w} role="columnheader" className="label text-right">{label}</span>)}
          </div>
          <div className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.sku ?? 'all'} role="row" className={`glass-row px-3 py-2.5 ${grid} ${r.sku === null ? 'font-bold' : ''}`}>
                <span role="rowheader" className="block font-semibold text-ink">{r.name}</span>
                {WINDOWS.map(([w, label]) => (
                  <span key={w} role="cell" className="mt-2 grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 @min-[40rem]:mt-0 @min-[40rem]:block @min-[40rem]:text-right">
                    <span className="label self-start pt-1 font-normal @min-[40rem]:hidden">{label}</span>
                    <span className="min-w-0"><DeliveryCell c={r.cells[w]} /></span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function DeliveryCell({ c }: { c: DeliveryRow['cells']['lifetime'] }) {
  const all = rateOf(c.all)
  if (all === null) return <span className="text-ink-3">—</span>
  const part = (label: string, x: Closed) => { const v = rateOf(x); return `${label} ${v === null ? '—' : pct(v, 1)}` }
  return (
    <>
      <span className="block text-base font-bold text-ink">{pct(all, 1)}</span>
      <span className="block text-xs text-ink-3">{c.all.delivered + c.all.rto} closed</span>
      <span className="block text-xs font-normal text-ink-2">{part('COD', c.cod)} · {part('Prepaid', c.prepaid)}</span>
    </>
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
