import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import type { AdsDay, AdsZone, CampaignStats, SortKey, StoreAds } from '@/lib/ads'
import { breaksEven, noBreakevenText, roasZone, type Breakeven } from '@/lib/calculator'
import { fmtX, inr, pct } from '@/lib/metrics'
import type { StoreId } from '@/lib/types'
import { StoreDot } from './bits'

const rs = (paise: number) => inr(paise / 100)
const n = (x: number) => x.toLocaleString('en-IN')
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

export const ZONE: Record<AdsZone, { word: string; tone: string }> = {
  below: { word: 'Below breakeven', tone: 'text-bad' },
  covering: { word: 'Covering costs', tone: 'text-warn' },
  profit: { word: 'Above target', tone: 'text-good' },
  early: { word: 'Too early', tone: 'text-ink-3' },
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

/** "breakeven 3.75× · target 5.52×", or why there is none. */
function beText(be: Breakeven | null, what = 'Breakeven needs a product cost') {
  if (be === null) return what
  if (!breaksEven(be)) return noBreakevenText(be)
  return `breakeven ${fmtX(be.breakevenRoas)} · target ${fmtX(be.targetRoas)}`
}

/** Totals for what's on screen: one store, or all of them summed. Breakeven only for one store. */
export function AdsStatsRow({ t, be, single }: { t: Omit<StoreAds, 'storeId' | 'be' | 'zone'>; be: Breakeven | null; single: boolean }) {
  const zone = single && be !== null && t.roas !== null ? roasZone(t.roas, be) : null
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Stat label="Ad spend · Meta" value={rs(t.spendPaise)} note={`${n(t.impressions)} impressions · ${n(t.clicks)} link clicks`} />
      <Stat label="Revenue · Shopify" value={rs(t.revenuePaise)} note={`${t.orders} ${t.orders === 1 ? 'order' : 'orders'}, incl. GST, cancelled left out`} />
      <Stat
        label="ROAS · all orders"
        value={t.roas === null ? '—' : <span className={zone ? ZONE[zone].tone : ''}>{fmtX(t.roas)}</span>}
        note={t.roas === null ? 'No spend in this range' : single ? <>{zone ? `${ZONE[zone].word} · ` : ''}{beText(be)}</> : 'Breakeven per store below'}
      />
      <Stat label="CPA · all orders" value={t.cpa === null ? '—' : inr(t.cpa)} note={single && be !== null && breaksEven(be) ? `breakeven ${inr(be.breakevenCpa)} per order` : 'Spend ÷ every order'} />
      <Stat
        label="Tracked orders"
        value={t.orders === 0 ? '—' : `${t.trackedOrders} of ${t.orders}`}
        note={`carry a campaign ID · Meta reported ${n(t.metaPurchases)} purchases`}
      />
    </div>
  )
}

const th = 'label px-4 py-3 font-normal whitespace-nowrap'

/** One row per store plus the total, when All VXP is on. */
export function StoreAdsTable({ rows, storeName }: { rows: StoreAds[]; storeName: (id: string) => string }) {
  return (
    <div className="overflow-x-auto rounded-xl bg-raised">
      <table className="w-full min-w-[820px] text-left text-sm tabular-nums">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={th}>Store</th>
            {['Spend', 'Orders', 'Revenue', 'ROAS', 'CPA', 'Tracked'].map((h) => <th key={h} scope="col" className={`${th} text-right`}>{h}</th>)}
            <th scope="col" className={th}>Breakeven</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.storeId} className="border-b border-line last:border-0">
              <th scope="row" className="px-4 py-3 font-semibold text-ink whitespace-nowrap">
                <span className="inline-flex items-center gap-2"><StoreDot id={s.storeId} />{storeName(s.storeId)}</span>
              </th>
              <td className="px-4 py-3 text-right text-ink">{rs(s.spendPaise)}</td>
              <td className="px-4 py-3 text-right text-ink-2">{s.orders}</td>
              <td className="px-4 py-3 text-right text-ink-2">{rs(s.revenuePaise)}</td>
              <td className={`px-4 py-3 text-right font-semibold ${s.zone ? ZONE[s.zone].tone : 'text-ink'}`}>{s.roas === null ? '—' : fmtX(s.roas)}</td>
              <td className="px-4 py-3 text-right text-ink-2">{s.cpa === null ? '—' : inr(s.cpa)}</td>
              <td className="px-4 py-3 text-right text-ink-2">{s.orders === 0 ? '—' : pct(s.trackedOrders / s.orders)}</td>
              <td className="px-4 py-3 text-ink-3">{s.spendPaise === 0 && s.orders === 0 ? 'No ads, no orders' : beText(s.be)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Every campaign that spent or took an attributed order, with sortable spend, orders, CPA and ROAS. */
export function CampaignsTable({ rows, sort, sortHref, storeName, showStore }: {
  rows: CampaignStats[]; sort: SortKey; sortHref: (k: SortKey) => string; storeName: (id: string) => string; showStore: boolean
}) {
  if (rows.length === 0) return <p className="rounded-xl bg-raised p-6 text-ink-2">No campaign spent or took an order in this range.</p>
  const sortable = (k: SortKey, label: string) => (
    <th scope="col" className={`${th} text-right`} aria-sort={sort === k ? (k === 'cpa' ? 'ascending' : 'descending') : undefined}>
      <Link href={sortHref(k)} className={sort === k ? 'font-semibold text-ink' : 'hover:text-ink'}>{label}{sort === k ? (k === 'cpa' ? ' ↑' : ' ↓') : ''}</Link>
    </th>
  )
  return (
    <div className="overflow-x-auto rounded-xl bg-raised">
      <table className="w-full min-w-[1080px] text-left text-sm tabular-nums">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={th}>Campaign</th>
            {sortable('spend', 'Spend')}
            {sortable('orders', 'Orders')}
            {sortable('cpa', 'CPA')}
            {sortable('roas', 'ROAS')}
            <th scope="col" className={th}>Against breakeven</th>
            {['Meta purch.', 'CPM', 'CTR'].map((h) => <th key={h} scope="col" className={`${th} text-right`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const z = c.zone ? ZONE[c.zone] : null
            return (
              <tr key={c.id} className="border-b border-line align-top last:border-0">
                <th scope="row" className="max-w-[340px] px-4 py-3 font-semibold text-ink">
                  <span className="flex items-start gap-2"><span className="mt-1.5"><StoreDot id={c.storeId as StoreId} /></span><span className="break-words">{c.name}</span></span>
                  <span className="mt-0.5 block pl-4 text-xs font-normal text-ink-3">
                    {showStore ? `${storeName(c.storeId)} · ` : ''}
                    {c.sku ?? <span className="text-warn">URL matches no product</span>}
                    {c.status ? ` · ${c.status.toLowerCase()}` : ''}
                    {c.url ? <> · <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center text-ink-2 hover:text-ink">Ads Manager<ArrowUpRight className="size-3" aria-hidden /></a></> : null}
                  </span>
                </th>
                <td className="px-4 py-3 text-right text-ink">{rs(c.spendPaise)}</td>
                <td className="px-4 py-3 text-right text-ink-2">{c.orders}</td>
                {/* Coloured by the ROAS verdict, not CPA vs breakeven CPA: that breakeven assumes one unit per order, so bigger baskets would read as a loss. */}
                <td className={`px-4 py-3 text-right ${c.zone === 'below' ? 'font-semibold text-bad' : 'text-ink'}`}>
                  {c.cpa === null ? '—' : inr(c.cpa)}
                  {c.be && breaksEven(c.be) ? <span className="block text-xs font-normal text-ink-3" title="Breakeven cost per order for a one-unit order">BE {inr(c.be.breakevenCpa)} / unit</span> : null}
                </td>
                <td className={`px-4 py-3 text-right font-semibold ${z ? z.tone : 'text-ink'}`}>{c.roas === null ? '—' : fmtX(c.roas)}</td>
                <td className="px-4 py-3">
                  {c.roas === null ? <span className="text-ink-3">No spend in this range</span>
                    : z ? <><span className={`font-semibold ${z.tone}`}>{z.word}</span><span className="block text-xs text-ink-3">{c.zone === 'early' ? `${rs(c.spendPaise)} spent, under one breakeven CPA` : beText(c.be)}</span></>
                    : <span className="text-ink-3">{c.sku === null ? 'No product, no breakeven' : 'Breakeven needs a product cost'}</span>}
                </td>
                <td className="px-4 py-3 text-right text-ink-2">{n(c.metaPurchases)}</td>
                <td className="px-4 py-3 text-right text-ink-2">{c.cpm === null ? '—' : inr(c.cpm)}</td>
                <td className="px-4 py-3 text-right text-ink-2">{c.ctr === null ? '—' : pct(c.ctr, 2)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Spend and orders per day, newest first, with a bar for spend so the shape shows without a chart. */
export function DailyTable({ rows }: { rows: AdsDay[] }) {
  const max = Math.max(1, ...rows.map((r) => r.spendPaise))
  return (
    <div className="overflow-x-auto rounded-xl bg-raised">
      <table className="w-full min-w-[880px] text-left text-sm tabular-nums">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={th}>Day</th>
            {['Spend', 'Impressions', 'Link clicks', 'Meta purch.', 'Orders', 'Tracked', 'Revenue', 'ROAS'].map((h) => <th key={h} scope="col" className={`${th} text-right`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date} className="border-b border-line last:border-0">
              <th scope="row" className="px-4 py-2.5 font-normal text-ink-2 whitespace-nowrap">{dayLabel(r.date)}</th>
              <td className="px-4 py-2.5 text-right text-ink">
                <span className="inline-flex items-center justify-end gap-3">
                  <span aria-hidden className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-line sm:inline-block">
                    <span className="block h-full rounded-full bg-spend" style={{ width: `${(r.spendPaise / max) * 100}%` }} />
                  </span>
                  {rs(r.spendPaise)}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right text-ink-2">{n(r.impressions)}</td>
              <td className="px-4 py-2.5 text-right text-ink-2">{n(r.clicks)}</td>
              <td className="px-4 py-2.5 text-right text-ink-2">{n(r.metaPurchases)}</td>
              <td className="px-4 py-2.5 text-right text-ink">{r.orders}</td>
              <td className="px-4 py-2.5 text-right text-ink-2">{r.trackedOrders}</td>
              <td className="px-4 py-2.5 text-right text-ink-2">{rs(r.revenuePaise)}</td>
              <td className="px-4 py-2.5 text-right text-ink">{r.roas === null ? '—' : fmtX(r.roas)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
