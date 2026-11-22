import Link from 'next/link'
import { AlertTriangle, ArrowUpRight } from 'lucide-react'
import { SORTS, type AdsDay, type AdsZone, type CampaignStats, type SortKey, type StoreAds } from '@/lib/ads'
import { breaksEven, noBreakevenText, roasZone, type Breakeven, type RoasZone } from '@/lib/calculator'
import { fmtX, inr, pct } from '@/lib/metrics'
import { StoreDot } from './bits'
import { RoasTrack } from './RoasTrack'

const rs = (paise: number) => inr(paise / 100)
const n = (x: number) => x.toLocaleString('en-IN')
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
type Totals = Omit<StoreAds, 'storeId' | 'be' | 'zone'>

export const ZONE: Record<AdsZone, { word: string; tone: string }> = {
  below: { word: 'Below breakeven', tone: 'text-bad' },
  covering: { word: 'Covering costs', tone: 'text-revenue' },
  profit: { word: 'Above target', tone: 'text-good' },
  early: { word: 'Too early', tone: 'text-ink-3' },
}

function verdict(rows: CampaignStats[], spend: number, range: string, allDisconnected: boolean, hasDisconnected: boolean) {
  if (spend === 0) {
    if (allDisconnected) return 'Meta not connected.'
    return `No ads ran in ${range}${hasDisconnected ? ' for connected accounts' : ''}.`
  }
  const spending = rows.filter((c) => c.spendPaise > 0)
  const below = spending.filter((c) => c.zone === 'below')
  const profit = spending.filter((c) => c.zone === 'profit').length
  const covering = spending.filter((c) => c.zone === 'covering').length
  const early = spending.filter((c) => c.zone === 'early').length
  const missingCost = spending.filter((c) => c.zone === null).length

  const sentences: string[] = []
  if (below.length) {
    sentences.push(`${rs(below.reduce((sum, c) => sum + c.spendPaise, 0))} of ${rs(spend)} spend is in ${below.length} ${below.length === 1 ? 'campaign' : 'campaigns'} below breakeven.`)
  } else if ((profit || covering) && !early && !missingCost && !hasDisconnected) {
    sentences.push('No campaign is below breakeven.')
  }
  if (profit) sentences.push(`${profit} ${profit === 1 ? 'campaign is' : 'campaigns are'} above target.`)
  if (!below.length && !profit && covering) sentences.push(`${covering} ${covering === 1 ? 'campaign is' : 'campaigns are'} covering costs.`)
  if (early) sentences.push(`${early} ${early === 1 ? 'campaign is' : 'campaigns are'} too early to judge.`)
  if (missingCost) sentences.push(`No cost data for ${missingCost} ${missingCost === 1 ? 'campaign' : 'campaigns'}.`)
  return sentences.join(' ') || 'No campaign data for this period.'
}

const heroFigure = 'text-[2.6rem] font-extrabold leading-none tracking-[-0.035em]'
const heroCell = 'min-w-0 border-line lg:border-l lg:pl-8'
const figure = 'text-[1.3rem] @min-[50rem]:text-[1.125rem] @min-[60rem]:text-[1.3rem] font-bold leading-tight'
const note = 'text-xs text-ink-3'
const source = 'block text-[0.6875rem] font-normal normal-case tracking-normal text-ink-3'

export function AdsVerdict({ t, be, single, rows, range, period, scope, months, notConnected, allDisconnected }: {
  t: Totals; be: Breakeven | null; single: boolean; rows: CampaignStats[]; range: string; period: string
  scope: string; months: React.ReactNode; notConnected: string[]; allDisconnected: boolean
}) {
  const zone = single && be && t.roas !== null ? roasZone(t.roas, be) : null
  return (
    <section aria-label="Ads verdict" className="glass rise grid gap-x-8 gap-y-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
      <div className="flex flex-wrap items-center justify-between gap-3 lg:col-span-3">
        <p className="label">Ads · {range} · {scope}</p>
        {months}
      </div>
      <div className="min-w-0 lg:self-center">
        <h1 className="text-balance text-[clamp(1.5rem,2.2vw,2.1rem)] font-extrabold leading-[1.12] tracking-[-0.025em]">{verdict(rows, t.spendPaise, range, allDisconnected, notConnected.length > 0)}</h1>
        <p className={`mt-1 ${note}`}>Campaign ROAS counts tracked orders only ({t.trackedOrders} of {t.orders}).</p>
        {notConnected.length > 0 && <p className="mt-1 flex items-start gap-2 text-sm text-warn"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />Meta not connected yet: {notConnected.join(', ')}.</p>}
      </div>
      <div className={heroCell}>
        <p className="label">Spend · {period} · Meta</p>
        <p className={`mt-1 ${heroFigure}`}>{rs(t.spendPaise)}</p>
        <p className="mt-1 text-sm text-ink-2">{n(t.impressions)} impressions · {n(t.clicks)} link clicks</p>
      </div>
      <div className={`${heroCell} w-full max-w-[18rem]${single ? ' lg:w-[18rem]' : ''}`}>
        <p className="label">ROAS · all orders · Meta + Shopify</p>
        <div className="mt-1">
          <AdsRoas roas={t.roas} be={be} zone={zone} aggregate={!single} className={heroFigure} />
        </div>
        <p className="mt-1 text-sm text-ink-2">{t.orders} orders · {rs(t.revenuePaise)}</p>
      </div>
    </section>
  )
}

function AdsRoas({ roas, be, zone, aggregate = false, unmatched = false, className = figure }: {
  roas: number | null; be: Breakeven | null; zone: RoasZone | null; aggregate?: boolean; unmatched?: boolean; className?: string
}) {
  if (roas === null) return <p className={note}>No spend in this range <span className="sr-only">—</span></p>
  if (aggregate) return <><p className={`${className} text-revenue`}>{fmtX(roas)}</p><p className={note}>Breakeven per store below</p></>
  if (be === null) return <><p className={`${className} text-revenue`}>{fmtX(roas)}</p><p className="text-xs text-warn">{unmatched ? 'No product, no breakeven' : 'Breakeven needs a product cost'}</p></>
  if (!breaksEven(be)) return <><p className={`${className} text-bad`}>{fmtX(roas)}</p><p className="text-xs text-bad">{noBreakevenText(be)}</p></>
  return <RoasTrack roas={roas} be={be.breakevenRoas} target={be.targetRoas} zone={zone} />
}

function Stat({ label, value, detail, className = '' }: { label: string; value: string; detail: string; className?: string }) {
  return (
    <div className={`px-3 py-3 ${className}`}>
      <p className="label">{label}</p>
      <p className="text-[1.3rem] font-bold">{value}</p>
      <p className={note}>{detail}</p>
    </div>
  )
}

export function AdsStatsRow({ t, be, single, period }: { t: Totals; be: Breakeven | null; single: boolean; period: string }) {
  return (
    <section aria-label="Ads statistics" className="glass grid grid-cols-2 gap-x-2 p-2 md:grid-cols-3 md:divide-x md:divide-line">
      <Stat label={`Revenue · ${period} · Shopify`} value={rs(t.revenuePaise)} detail={`${t.orders} ${t.orders === 1 ? 'order' : 'orders'}, incl. GST, cancelled left out`} />
      <Stat label={`CPA · ${period} · all orders`} value={t.cpa === null ? '—' : inr(t.cpa)} detail={single && be && breaksEven(be) ? `breakeven ${inr(be.breakevenCpa)} per order` : 'Spend ÷ every order'} />
      <Stat label={`Tracked orders · ${period} · Shopify`} value={t.orders === 0 ? '—' : `${t.trackedOrders} of ${t.orders}`} detail={`carry a campaign ID · Meta reported ${n(t.metaPurchases)} purchases`} className="col-span-2 border-t border-line md:col-span-1 md:border-t-0" />
    </section>
  )
}

const row = 'grid-cols-2 gap-x-4 gap-y-3 @min-[50rem]:gap-x-3 @min-[60rem]:gap-x-4 @min-[50rem]:content-center @min-[50rem]:items-baseline @min-[50rem]:gap-y-0'
const storeGrid = `${row} @min-[50rem]:grid-cols-[minmax(6.75rem,1.15fr)_minmax(4.5rem,1fr)_minmax(3.75rem,0.9fr)_minmax(9.5rem,1.9fr)_minmax(6.75rem,1.15fr)_minmax(5.5rem,1.1fr)_5.75rem] @min-[60rem]:grid-cols-[minmax(7.5rem,1.15fr)_minmax(4.5rem,1fr)_minmax(3.5rem,0.9fr)_minmax(10.5rem,1.9fr)_minmax(5rem,1.15fr)_minmax(5.5rem,1.1fr)_5.75rem] [grid-template-areas:"name_call"_"roas_roas"_"spend_orders"_"rev_cpa"] @min-[50rem]:[grid-template-areas:"name_spend_orders_roas_rev_cpa_call"]`
const campaignGrid = `${row} @min-[50rem]:grid-cols-[minmax(12rem,2.4fr)_minmax(5.5rem,1fr)_minmax(3.5rem,0.6fr)_minmax(6rem,1fr)_minmax(11rem,2fr)_5.75rem] @min-[72rem]:grid-cols-[minmax(14rem,2.4fr)_minmax(5.5rem,1fr)_minmax(3.5rem,0.6fr)_minmax(6rem,1fr)_minmax(11rem,2fr)_4.5rem_5rem_4.5rem_5.75rem] [grid-template-areas:"name_call"_"roas_roas"_"spend_orders"_"cpa_cpa"_"meta_meta"] @min-[50rem]:[grid-template-areas:"name_spend_orders_cpa_roas_call"] @min-[72rem]:[grid-template-areas:"name_spend_orders_cpa_roas_purch_cpm_ctr_call"]`
const headRow = 'hidden px-3 pb-2 pt-2 @min-[50rem]:grid'
const glassRow = 'glass-row grid px-3 py-3 @min-[50rem]:min-h-[4.5rem] @min-[50rem]:py-2'
const callCell = 'flex justify-end [grid-area:call] @min-[50rem]:justify-center'

function Head({ area, label, detail, sort, className = '' }: {
  area: string; label: string; detail?: string; sort?: 'ascending' | 'descending'; className?: string
}) {
  return (
    <div role="columnheader" aria-sort={sort} style={{ gridArea: area }} className={`label whitespace-nowrap leading-tight ${className}`}>
      {label}{sort === 'ascending' ? ' ↑' : sort === 'descending' ? ' ↓' : ''}
      {detail && <span className={source}>{detail}</span>}
    </div>
  )
}

function MobileLabel({ children }: { children: string }) {
  return <span className={`${note} @min-[50rem]:hidden`}>{children} </span>
}

function Cell({ area, label, value, detail }: { area: string; label: string; value: string; detail?: string }) {
  return (
    <div role="cell" className="min-w-0" style={{ gridArea: area }}>
      <MobileLabel>{label}</MobileLabel>
      <p className={figure}>{value}</p>
      {detail && <p className={note}>{detail}</p>}
    </div>
  )
}

const neutral = 'text-ink-2 ring-line-strong'
const warning = 'text-warn ring-warn/40 bg-warn/10'
const calls = {
  below: ['Cut or fix', 'text-bad ring-bad/45 bg-bad/12'],
  covering: ['Hold', 'text-revenue ring-revenue/40 bg-revenue/10'],
  profit: ['Scale', 'text-good ring-good/45 bg-good/12'],
  early: ['Too early', neutral],
} as const

function CallChip({ roas, be, zone, unmatched = false, noSpend = 'No spend' }: {
  roas: number | null; be: Breakeven | null; zone: AdsZone | null; unmatched?: boolean; noSpend?: string
}) {
  const [word, cls] = roas === null ? [noSpend, neutral]
    : unmatched ? ['Check URL', warning]
    : be === null ? ['Add cost', warning]
    : !breaksEven(be) ? calls.below
    : calls[zone ?? 'covering']
  return <span className={`inline-block min-w-[5.25rem] whitespace-nowrap rounded-lg px-3 py-1.5 text-center text-sm font-semibold ring-1 ${cls}`}>{word}</span>
}

export function StoreAdsTable({ rows, storeName, period }: { rows: StoreAds[]; storeName: (id: string) => string; period: string }) {
  return (
    <section aria-labelledby="ads-stores" className="glass p-2">
      <h2 id="ads-stores" className="sr-only">Stores</h2>
      <div role="table" aria-labelledby="ads-stores" className="@container">
        <div role="row" className={`${storeGrid} ${headRow}`}>
          <Head area="name" label="Store" />
          <Head area="spend" label="Spend" detail={`${period} · Meta`} />
          <Head area="orders" label="Orders" detail={`${period} · Shopify`} />
          <Head area="roas" label="ROAS vs breakeven" detail={`${period} · Meta + Shopify`} />
          <Head area="rev" label="Revenue" detail={`${period} · Shopify`} />
          <Head area="cpa" label="CPA" detail={`${period} · All orders`} />
          <Head area="call" label="Call" className="text-center" />
        </div>
        <div role="rowgroup" className="space-y-1.5">
          {rows.map((s) => {
            const idle = s.spendPaise === 0 && s.orders === 0
            return (
              <div role="row" key={s.storeId} className={`${glassRow} ${storeGrid}${idle ? ' text-ink-3' : ''}`}>
                <div role="rowheader" className="flex items-center gap-2.5 text-[1.6rem] @min-[50rem]:text-[1.35rem] @min-[60rem]:text-[1.6rem] font-bold tracking-[-0.02em] [grid-area:name]"><StoreDot id={s.storeId} size={9} />{storeName(s.storeId)}</div>
                <Cell area="spend" label="Spend" value={rs(s.spendPaise)} />
                <Cell area="orders" label="Orders" value={String(s.orders)} detail={s.orders === 0 ? undefined : `${pct(s.trackedOrders / s.orders)} tracked`} />
                <div role="cell" className="[grid-area:roas]">
                  <MobileLabel>ROAS vs breakeven</MobileLabel>
                  {idle ? <p className={note}>No ads, no orders</p> : <AdsRoas roas={s.roas} be={s.be} zone={s.zone} />}
                  {!idle && s.roas === null && s.be && breaksEven(s.be) &&
                    <p className={note}>BE {fmtX(s.be.breakevenRoas)} · Target {fmtX(s.be.targetRoas)}</p>}
                </div>
                <Cell area="rev" label="Revenue" value={rs(s.revenuePaise)} />
                <Cell area="cpa" label="CPA" value={s.cpa === null ? '—' : inr(s.cpa)} />
                <div role="cell" className={callCell}><CallChip roas={s.roas} be={s.be} zone={s.zone} noSpend="No ads" /></div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

const sortLabels: Record<SortKey, string> = { spend: 'Spend', orders: 'Orders', cpa: 'CPA', roas: 'ROAS' }

export function CampaignsTable({ rows, sort, sortHref, storeName, showStore, period }: {
  rows: CampaignStats[]; sort: SortKey; sortHref: (k: SortKey) => string; storeName: (id: string) => string; showStore: boolean; period: string
}) {
  const direction = (key: SortKey) => sort === key ? (key === 'cpa' ? 'ascending' : 'descending') : undefined
  return (
    <section aria-labelledby="ads-campaigns" className="glass p-2">
      <header className="flex flex-wrap items-center justify-between gap-3 px-3 pt-2">
        <h2 id="ads-campaigns" className="text-lg font-bold">Campaigns <span className="font-normal text-ink-3">· {rows.length}</span></h2>
        <nav aria-label="Sort campaigns" className="glass-pill inline-flex p-[3px] text-sm">
          {SORTS.map((k) => <Link key={k} href={sortHref(k)} aria-current={sort === k ? 'true' : undefined} className={`inline-flex h-[30px] items-center rounded-[0.6rem] px-3 ${sort === k ? 'glass-pill-on font-semibold text-ink' : 'text-ink-2 hover:text-ink'}`}>{sortLabels[k]}</Link>)}
        </nav>
      </header>
      {rows.length === 0 ? <p className="mt-3 px-3 pb-2 text-ink-2">No campaign spent or took an order in this range.</p> : (
        <div role="table" aria-labelledby="ads-campaigns" className="@container mt-3">
          <div role="row" className={`${campaignGrid} ${headRow}`}>
            <Head area="name" label="Campaign" />
            <Head area="spend" label="Spend" detail={`${period} · Meta`} sort={direction('spend')} />
            <Head area="orders" label="Orders" detail="Tracked · Shopify" sort={direction('orders')} />
            <Head area="cpa" label="CPA" detail="Tracked" sort={direction('cpa')} />
            <Head area="roas" label="ROAS vs breakeven" detail={`${period} · Tracked`} sort={direction('roas')} />
            <Head area="purch" label="Purch." detail={`${period} · Meta`} className="hidden @min-[72rem]:block" />
            <Head area="cpm" label="CPM" detail={`${period} · Meta`} className="hidden @min-[72rem]:block" />
            <Head area="ctr" label="CTR" detail={`${period} · Meta`} className="hidden @min-[72rem]:block" />
            <Head area="call" label="Call" className="text-center" />
          </div>
          <div role="rowgroup" className="space-y-1.5">
            {rows.map((c) => {
              const cpm = c.cpm === null ? '—' : inr(c.cpm)
              const ctr = c.ctr === null ? '—' : pct(c.ctr, 2)
              const purchases = n(c.metaPurchases)
              const metadata = <>
                {showStore ? `${storeName(c.storeId)} · ` : ''}
                {c.sku ?? <span className="text-warn">URL matches no product</span>}
                {c.status ? ` · ${c.status.toLowerCase()}` : ''}
                {c.url && <> · <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center text-ink-2 hover:text-ink">Ads Manager<ArrowUpRight className="size-3" aria-hidden /></a></>}
              </>
              const secondary = `${purchases} Meta purch. · CPM ${cpm} · CTR ${ctr}`
              const breakevenCpa = c.be && breaksEven(c.be) ? inr(c.be.breakevenCpa) : null
              return (
                <div role="row" key={c.id} className={`${glassRow} ${campaignGrid}`}>
                  <div role="rowheader" className="min-w-0 [grid-area:name]">
                    <div className="flex items-start gap-2 font-semibold leading-tight @min-[50rem]:text-[1.35rem]">
                      <span className="mt-1.5 shrink-0"><StoreDot id={c.storeId} /></span>
                      <span className="line-clamp-2 [overflow-wrap:anywhere]" title={c.name}>{c.name}</span>
                    </div>
                    <p className={`hidden [overflow-wrap:anywhere] @min-[50rem]:block ${note}`}>{metadata}</p>
                    <p className={`hidden @min-[50rem]:block @min-[72rem]:hidden ${note}`}>{secondary}</p>
                  </div>
                  <Cell area="spend" label="Spend" value={rs(c.spendPaise)} />
                  <Cell area="orders" label="Orders" value={String(c.orders)} />
                  <div role="cell" className="grid grid-cols-2 items-end gap-x-4 [grid-area:cpa] @min-[50rem]:block">
                    <div>
                      <MobileLabel>CPA</MobileLabel>
                      {/* The unit breakeven assumes one unit per order, so CPA takes its tone from the ROAS verdict. */}
                      <p className={`${figure} ${c.zone === 'below' ? ZONE.below.tone : ''}`}>{c.cpa === null ? '—' : inr(c.cpa)}</p>
                    </div>
                    {breakevenCpa && <p className={note} title="Breakeven cost per order for a one-unit order">BE {breakevenCpa} / unit</p>}
                  </div>
                  <div role="cell" className="[grid-area:roas]">
                    <MobileLabel>ROAS vs breakeven</MobileLabel>
                    {c.zone === 'early' && c.roas !== null
                      ? <><p className="font-semibold text-ink-2">Too early · {fmtX(c.roas)}</p><p className={note}>{rs(c.spendPaise)} spent, under one breakeven CPA</p></>
                      : <AdsRoas roas={c.roas} be={c.be} zone={c.zone === 'early' ? null : c.zone} unmatched={c.sku === null} />}
                  </div>
                  <div role="cell" className={`[grid-area:meta] [overflow-wrap:anywhere] @min-[50rem]:hidden ${note}`}>
                    <p>{metadata}</p>
                    <p>{secondary}</p>
                  </div>
                  <div role="cell" className="hidden text-ink-2 [grid-area:purch] @min-[72rem]:block">{purchases}</div>
                  <div role="cell" className="hidden text-ink-2 [grid-area:cpm] @min-[72rem]:block">{cpm}</div>
                  <div role="cell" className="hidden text-ink-2 [grid-area:ctr] @min-[72rem]:block">{ctr}</div>
                  <div role="cell" className={callCell}><CallChip roas={c.roas} be={c.be} zone={c.zone} unmatched={c.sku === null} /></div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

const dailyGrid = 'grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 items-baseline @min-[60rem]:grid-cols-[minmax(7rem,1fr)_minmax(11rem,1.6fr)_repeat(6,minmax(4.5rem,1fr))]'

export function DailyTable({ rows, range, period }: { rows: AdsDay[]; range: string; period: string }) {
  const max = Math.max(1, ...rows.map((r) => r.spendPaise))
  return (
    <section aria-labelledby="ads-daily" className="glass p-2">
      <h2 id="ads-daily" className="px-3 pt-2 text-lg font-bold">Daily spend <span className="text-sm font-medium text-ink-3">{range} · Meta + Shopify</span></h2>
      <div role="table" aria-labelledby="ads-daily" className="@container mt-3">
        <div role="row" className={`hidden px-3 pb-2 @min-[60rem]:grid ${dailyGrid}`}>
          {[
            ['Day', ''],
            ['Spend', 'Meta'],
            ['Orders', 'Shopify'],
            ['Revenue', 'Shopify'],
            ['ROAS', 'Meta + Shopify'],
            ['Impressions', 'Meta'],
            ['Link clicks', 'Meta'],
            ['Meta purch.', 'Meta'],
          ].map(([label, from]) => <div role="columnheader" key={label} className="label leading-tight">{label}{from && <span className={source}>{period} · {from}</span>}</div>)}
        </div>
        <div role="rowgroup" className="divide-y divide-line">
          {rows.map((r) => {
            const roas = r.roas === null ? '—' : fmtX(r.roas)
            return (
              <div role="row" key={r.date} className={`grid px-3 py-2.5 text-sm font-semibold ${dailyGrid} ${r.spendPaise === 0 ? 'text-ink-3' : 'text-ink-2'}`}>
                <div role="rowheader">{dayLabel(r.date)}</div>
                <div role="cell" className="inline-flex items-center gap-2">
                  <span className="sr-only @min-[60rem]:hidden">Spend </span>
                  <span aria-hidden className="h-1.5 w-12 overflow-hidden rounded-full bg-line @min-[60rem]:w-20">
                    <span className="block h-full rounded-full bg-spend" style={{ width: `${(r.spendPaise / max) * 100}%` }} />
                  </span>
                  {rs(r.spendPaise)}
                </div>
                <div role="cell" className={`col-span-2 font-normal @min-[60rem]:hidden ${note}`}>{r.orders} orders · {r.trackedOrders} tracked · {rs(r.revenuePaise)} revenue · {roas} ROAS</div>
                <div role="cell" className="col-span-2 text-xs font-normal text-ink-2 @min-[60rem]:hidden">{n(r.impressions)} impressions · {n(r.clicks)} link clicks · {n(r.metaPurchases)} Meta {r.metaPurchases === 1 ? 'purchase' : 'purchases'}</div>
                <div role="cell" className="hidden @min-[60rem]:block">{r.orders}<p className={note}>{r.trackedOrders} tracked</p></div>
                <div role="cell" className="hidden @min-[60rem]:block">{rs(r.revenuePaise)}</div>
                <div role="cell" className="hidden @min-[60rem]:block">{roas}</div>
                <div role="cell" className="hidden @min-[60rem]:block">{n(r.impressions)}</div>
                <div role="cell" className="hidden @min-[60rem]:block">{n(r.clicks)}</div>
                <div role="cell" className="hidden @min-[60rem]:block">{n(r.metaPurchases)}</div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
