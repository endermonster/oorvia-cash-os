import Link from 'next/link'
import { AlertTriangle, ChevronRight, CircleCheck, FileText, PieChart, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { breaksEven, noBreakevenText } from '@/lib/calculator'
import { fmtX, inr, pct, PERIODS, type Call, type Metrics, type Period, type Portfolio, type StoreStats } from '@/lib/metrics'
import { href, type ViewState } from '@/lib/nav'
import { istNow } from '@/lib/dates'
import type { StoreId } from '@/lib/types'
import { Delta, rateSourceNote, Signed, tone } from './bits'
import { HighlightStatus, HighlightValue, LinkedHighlight } from './LinkedHighlight'
import { LiveMap } from './LiveMap'
import { Overview } from './Overview'
import { RevenueChart } from './RevenueChart'
import { RoasTrack } from './RoasTrack'
import { pageFrame } from './TopBar'

export function HomeView({ view, period, m, now, mock }: { view: ViewState; period: Period; m: Metrics; now: Date; mock: boolean }) {
  const pf = m.portfolio(period)
  const ids = m.stores.map((s) => s.id)
  const resolved = m.resolvedCounts(ids, period)
  const sources = m.rateSources(undefined, period)
  // Said only when some store's estimate rests on something weaker than its own last 30 days.
  const rateNote = sources.some((s) => s.source !== 'own-30d') ? rateSourceNote(sources) : null
  const calls = m.calls(period)
  // Uncapped: calls() shows three, and a stop must lead the verdict even when it is not among them.
  const stopped = m.adsStopped()
  const missing = missingCosts(pf.stores)
  // The map follows the period, like the Stores table. The 60 newest orders hold every period ending today that has
  // up to 60 orders; a past custom range is fetched by the map itself on mount.
  const orders = m.recentOrders(ids, 60).filter((o) => { const d = istNow(new Date(o.placedAt)).today; return d >= period.from && d <= period.to })
  const series = m.series(ids, period)
  const end = series.at(-1)
  const { net, prevNet, fixedCosts } = pf.total
  // Each store's own slice, for the linked highlight: the overview and the chart show it while that store is traced.
  const perStore = pf.stores.map((s) => ({ stats: s, series: m.series([s.store.id], period) }))
  // Phone legend totals follow the traced store, like the chart lines.
  const endRev = Object.fromEntries(perStore.map((s) => [s.stats.store.id, inr(s.series.at(-1)?.cumRevenue ?? 0)]))
  const endSpend = Object.fromEntries(perStore.map((s) => [s.stats.store.id, inr(s.series.at(-1)?.cumSpend ?? 0)]))
  const names = Object.fromEntries(m.stores.map((s) => [s.id, s.name]))
  const v = verdict(pf.stores, m.metaNotConnected, stopped)

  return (
    <main className={`${pageFrame} space-y-3 pb-6 pt-3`}>
      <LinkedHighlight />
      <Overview total={pf.total} series={series} period={period} nowHour={istNow(now).hour} prevHoursComplete={m.yesterdayHoursComplete(ids)}
        stores={perStore} links={(k, store) => {
          const v = store ? { ...view, store: store.id as StoreId } : view
          const scope = store?.name ?? 'all stores'
          // Orders shows a calendar month (no period); Ads has only today, 7D, 30D and Month and falls back to 7D.
          if (k !== 'spend') return { href: href('/orders', v), label: `Orders for ${scope} (this month)` }
          const shown = PERIODS.some((p) => p.id === period.id) ? period.short : '7D'
          return { href: href('/ads', v), label: `Ad spend for ${scope} in Ads (${shown})` }
        }} />

      {/* The verdict leads, set on the one lime block on the page; the numbers behind it sit to its right. */}
      <section aria-label="Verdict" className="glass rise grid gap-2 p-2 sm:gap-2.5 sm:p-2.5 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div className="relative min-w-0 overflow-hidden rounded-xl bg-lime px-5 py-5 text-on-lime sm:px-6 sm:py-6 lg:self-stretch">
          <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-52 rounded-full bg-white/18" />
          <p className="relative mb-3 inline-flex h-6 items-center rounded-full bg-on-lime px-2.5 text-xs font-semibold text-lime">Verdict · {period.short}</p>
          <h1 className="relative text-balance text-[clamp(1.6rem,2.5vw,2.4rem)] font-bold leading-[1.12] tracking-[-0.035em]"><VerdictText text={v} stores={pf.stores} /></h1>
          {missing && <p className="relative mt-3 max-w-[75ch] text-[0.8125rem] font-semibold"><AlertTriangle className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />{missing}</p>}
        </div>
        <div className="glass-row px-5 py-5 lg:min-w-72 lg:self-stretch">
          <div data-hl-for="all">
            <p className="label">Projected profit · {period.short} · All stores</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className={`whitespace-nowrap text-[clamp(2.5rem,3.4vw,3.25rem)] font-semibold leading-none tracking-[-0.04em] ${tone(net)}`}>{net > 0 ? '+' : ''}<Signed value={net} /></p>
              {prevNet > 0
                ? <span className="inline-flex h-[22px] items-center rounded-md bg-white/6 px-1.5 [&>span]:text-xs"><Delta now={net} prev={prevNet} suffix={`vs ${period.prevLabel}`} /></span>
                : <span className="inline-flex h-[22px] items-center rounded-md bg-white/6 px-1.5 text-xs font-semibold text-ink-2">vs {inr(prevNet)} {period.prevLabel}</span>}
            </div>
            {/* w-0 min-w-full: the note wraps to the column instead of widening it and squeezing the verdict. */}
            {fixedCosts > 0 && <p className="mt-2.5 w-0 min-w-full text-xs text-ink-2">After {inr(fixedCosts)} fixed costs at run rate</p>}
            {rateNote && <p className="mt-1 w-0 min-w-full text-xs text-ink-4">Estimate · {rateNote}</p>}
          </div>
          {pf.stores.map((s) => (
            <div key={s.store.id} data-hl-for={s.store.id} hidden>
              <p className="label">Profit (est.) · {period.short} · {s.store.name}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className={`whitespace-nowrap text-[clamp(2.5rem,3.4vw,3.25rem)] font-semibold leading-none tracking-[-0.04em] ${tone(s.contribution)}`}>{s.contribution > 0 ? '+' : ''}<Signed value={s.contribution} /></p>
                <span className="inline-flex h-[22px] items-center rounded-md bg-white/6 px-1.5 text-xs font-semibold text-ink-2">of {net > 0 ? '+' : ''}{net < 0 ? '−' : ''}{inr(Math.abs(net))} VXP</span>
              </div>
              <p className="mt-2.5 w-0 min-w-full text-xs text-ink-4">Before VXP&apos;s fixed costs</p>
            </div>
          ))}
        </div>
        <div className="glass-row px-5 py-5 lg:self-stretch">
          <p className="label">Resolved · {period.short} · vFulfill</p>
          <p className="mt-3 text-[2.5rem] font-semibold leading-none tracking-[-0.04em]">{resolved.delivered}<span className="ml-2 text-[0.95rem] font-medium tracking-normal text-ink-3">delivered</span></p>
          <p className="mt-2.5"><span className="inline-flex h-[22px] items-center rounded-md bg-white/6 px-1.5 text-xs font-semibold text-ink-2">{resolved.rto} RTO{resolved.rate !== null && <> · {pct(resolved.rate)} delivered</>}</span></p>
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <Stores stores={pf.stores} total={pf.total} view={view} period={period} notConnected={m.metaNotConnected} names={names} />
          <Calls calls={calls} view={view} />
          <section aria-labelledby="pace-h" className="glass flex flex-col px-5 pb-3 pt-4 lg:flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <h2 id="pace-h" className="text-lg font-bold">Cumulative revenue vs spend <span className="block text-sm font-medium text-ink-3 sm:ml-2 sm:inline">{period.short} · Shopify + Meta</span></h2>
              <p className="flex items-center gap-5 text-sm text-ink-2">
                <span className="flex items-center gap-2"><span aria-hidden className="h-[3px] w-5 rounded-full bg-revenue" /><span>Revenue<span className="hidden sm:inline"> (cumulative)</span>{end && <span className="font-semibold text-revenue sm:hidden"> <HighlightValue vxp={inr(end.cumRevenue)} by={endRev} /></span>}</span></span>
                <span className="flex items-center gap-2"><span aria-hidden className="h-[3px] w-5 rounded-full bg-spend" /><span>Spend<span className="hidden sm:inline"> (cumulative)</span>{end && <span className={`whitespace-nowrap font-semibold sm:hidden ${end.cumSpend === 0 ? 'text-ink-2' : 'text-spend'}`}> <HighlightValue vxp={inr(end.cumSpend)} by={endSpend} /></span>}</span></span>
              </p>
            </div>
            <div className={`mt-3 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${end?.cumSpend === 0 ? '[&_.text-spend]:text-ink-2' : ''}`}>
              <RevenueChart points={series} unit={period.id === 'today' ? 'hour' : 'day'}
                byStore={perStore.map((s) => ({ id: s.stats.store.id, name: s.stats.store.name, points: s.series }))} />
            </div>
          </section>
        </div>

        <section aria-labelledby="map-h" className="glass flex min-w-0 flex-col p-2">
          <div className="flex items-center justify-between gap-4 px-3 pt-2">
            <h2 id="map-h" className="text-lg font-bold">Orders across India</h2>
            <p className="flex items-center gap-4 text-sm text-ink-2">
              <span className="flex items-center gap-2"><span aria-hidden className="size-2 rounded-[2px] bg-prepaid" />Prepaid</span>
              <span className="flex items-center gap-2"><span aria-hidden className="size-2 rounded-[2px] bg-cod" />COD</span>
            </p>
          </div>
          <div className="mt-3 flex min-h-0 flex-1 flex-col">
            <LiveMap key={`${period.from}:${period.to}`} initial={orders} stores={m.stores.map((s) => ({ id: s.id, name: s.name }))} serverNow={now.toISOString()} mock={mock} view={view}
              period={{ from: period.from, to: period.to, short: period.short, endsToday: period.to === istNow(now).today }} />
          </div>
        </section>
      </div>

      <BottomLine m={m} view={view} period={period} />
    </main>
  )
}

/**
 * The verdict, sentence by sentence: each sentence that names a store belongs to it (linked highlight), and a sentence
 * about a store not paying its way is set reversed (black on the lime) so the problem is the loudest words on the page.
 */
function VerdictText({ text, stores }: { text: string; stores: StoreStats[] }) {
  const sentences = text.split(/(?<=\.)\s+/)
  return sentences.map((t, i) => {
    const ids = stores.filter((s) => t.includes(s.store.name)).map((s) => s.store.id)
    const bad = /isn’t|aren’t|stopped|missing|not connected/.test(t)
    return (
      <span key={i}>
        {i > 0 && ' '}
        <span data-s={ids.length ? ids.join(' ') : undefined}
          className={`vs [box-decoration-break:clone] ${bad ? '-mx-[0.14em] bg-on-lime px-[0.14em] text-lime' : ''}`}>{t}</span>
      </span>
    )
  })
}

export function codShareLabel({ orders, codOrders, unknownPayOrders }: Pick<StoreStats, 'orders' | 'codOrders' | 'unknownPayOrders'>): string | undefined {
  const knownOrders = orders - unknownPayOrders
  return knownOrders > 0 ? `${pct(codOrders / knownOrders)} COD` : undefined
}

/** Cells share one first baseline, so a row's primary figures sit on one line and sub-lines hang below. */
const ROW = 'grid grid-cols-2 gap-x-4 @min-[50rem]:gap-x-3 @min-[60rem]:gap-x-4 gap-y-3 @min-[50rem]:content-center @min-[50rem]:items-baseline @min-[50rem]:gap-y-0 @min-[50rem]:grid-cols-[minmax(6.75rem,1.15fr)_minmax(4.5rem,1fr)_minmax(3.75rem,0.9fr)_minmax(9.5rem,1.9fr)_minmax(6.75rem,1.15fr)_minmax(5.5rem,1.1fr)_5.75rem] @min-[60rem]:grid-cols-[minmax(7.5rem,1.15fr)_minmax(4.5rem,1fr)_minmax(3.5rem,0.9fr)_minmax(10.5rem,1.9fr)_minmax(5rem,1.15fr)_minmax(5.5rem,1.1fr)_5.75rem] [grid-template-areas:"name_call"_"roas_roas"_"spend_orders"_"rev_profit"] @min-[50rem]:[grid-template-areas:"name_spend_orders_roas_rev_profit_call"]'

function Stores({ stores, total, view, period, notConnected, names }: { stores: StoreStats[]; total: Portfolio['total']; view: ViewState; period: Period; notConnected: (id: StoreId) => boolean; names: Record<string, string> }) {
  const head = 'label whitespace-nowrap leading-tight'
  const moneyHead = `${head} text-right`
  const src = (s: string) => <span className="block text-[0.6875rem] font-normal normal-case tracking-normal text-ink-3">{period.short} · {s}</span>
  // The total is the stores' sum less fixed costs at run rate, so it says so: the rows above add up to more.
  const fixed = total.fixedCosts
  return (
    <section aria-labelledby="stores-h" className="glass rise p-2 [--delay:80ms]">
      <div className="flex min-h-9 items-center justify-between gap-3 px-3 pt-1.5">
        <h2 id="stores-h" className="text-base font-semibold tracking-[-0.015em]">Stores</h2>
        <HighlightStatus names={names} />
      </div>
      <div role="table" aria-label="Stores" className="@container">
        <div role="row" className={`${ROW} hidden px-3 pb-2 pt-2 @min-[50rem]:grid`}>
          <span role="columnheader" className={`${head} [grid-area:name]`}>Store</span>
          <span role="columnheader" className={`${moneyHead} [grid-area:spend]`}>Spend{src('Meta')}</span>
          <span role="columnheader" className={`${head} [grid-area:orders]`}>Orders{src('Shopify')}</span>
          <span role="columnheader" className={`${head} [grid-area:roas]`}>ROAS vs breakeven{src('Meta')}</span>
          <span role="columnheader" className={`${moneyHead} [grid-area:rev]`}>Booked revenue{src('Shopify')}</span>
          <span role="columnheader" className={`${moneyHead} [grid-area:profit]`}>Profit (est.){src('Estimate')}</span>
          <span role="columnheader" className={`${head} [grid-area:call] text-center`}>Call</span>
        </div>
        <div className="space-y-1.5">
          {stores.map((s) => (
            // Hover traces the store across the page; click (or Enter) pins it. The name still opens its own view.
            <div role="row" key={s.store.id} data-s={s.store.id} tabIndex={0} aria-label={`${s.store.name}: trace across the page`}
              className={`glass-row store-row cursor-pointer ${ROW} px-3 py-3 @min-[50rem]:min-h-[4.5rem] @min-[50rem]:py-2`}>
              <span role="cell" className="[grid-area:name]">
                <Link href={href('/', { ...view, store: s.store.id })} className="inline-flex min-h-9 items-center gap-2 text-[1.35rem] @min-[50rem]:text-[1.2rem] @min-[60rem]:text-[1.3rem] font-semibold tracking-[-0.015em] hover:underline">
                  {s.store.name}
                </Link>
              </span>
              <Cell area="spend" label="Spend" value={inr(s.spend)} />
              <Cell area="orders" label="Orders" value={String(s.orders)} sub={codShareLabel(s)} />
              <span role="cell" className="[grid-area:roas]"><RoasBar s={s} off={notConnected(s.store.id)} /></span>
              <Cell area="rev" label="Booked revenue" value={inr(s.revenue)} />
              <span role="cell" className="text-right tabular-nums [grid-area:profit]">
                <span className="text-xs text-ink-3 @min-[50rem]:hidden">Profit (est.) </span>
                <span className={`block whitespace-nowrap text-[1.3rem] @min-[50rem]:text-[1.125rem] @min-[60rem]:text-[1.3rem] font-bold ${tone(s.contribution)}`}>{s.contribution > 0 ? '+' : ''}<Signed value={s.contribution} /></span>
                {s.contribution < 0 && <span className="text-xs text-bad">loss this period</span>}
              </span>
              <span role="cell" className="flex justify-end self-start [grid-area:call] @min-[50rem]:justify-center @min-[50rem]:self-baseline"><CallChip s={s} off={notConnected(s.store.id)} /></span>
            </div>
          ))}
          <div role="row" className={`${ROW} hl-total mx-0 !mt-2 border-t border-line-strong px-3 pb-2 pt-4 transition-opacity duration-200 @min-[50rem]:min-h-[4.5rem]`}>
            <span role="cell" className="text-[1.35rem] @min-[50rem]:text-[1.2rem] @min-[60rem]:text-[1.3rem] font-semibold tracking-[-0.015em] [grid-area:name]">VXP <span className="text-base font-medium text-ink-2">(total)</span></span>
            <Cell area="spend" label="Spend" value={inr(total.spend)} />
            <Cell area="orders" label="Orders" value={String(total.orders)} />
            <span role="cell" className="[grid-area:roas]"><VxpRoas total={total} /></span>
            <Cell area="rev" label="Booked revenue" value={inr(total.revenue)} />
            <span role="cell" className="text-right tabular-nums [grid-area:profit]">
              <span className="text-xs text-ink-3 @min-[50rem]:hidden">Profit (est.) </span>
              <span className={`block whitespace-nowrap text-[1.3rem] @min-[50rem]:text-[1.125rem] @min-[60rem]:text-[1.3rem] font-bold ${tone(total.net)}`}>{total.net > 0 ? '+' : ''}<Signed value={total.net} /></span>
              {fixed > 0 && <span className="text-xs text-ink-3">after {inr(fixed)} fixed</span>}
            </span>
            <span role="cell" aria-hidden className="[grid-area:call]" />
          </div>
        </div>
      </div>
    </section>
  )
}

function Cell({ area, label, value, sub }: { area: string; label: string; value: string; sub?: string }) {
  const money = area === 'spend' || area === 'rev'
  return (
    <span role="cell" className={`min-w-0 ${money ? 'whitespace-nowrap text-right tabular-nums' : ''}`} style={{ gridArea: area }}>
      <span className="text-xs text-ink-3 @min-[50rem]:hidden">{label} </span>
      <span className="block text-[1.3rem] @min-[50rem]:text-[1.125rem] @min-[60rem]:text-[1.3rem] font-semibold leading-tight">{value}</span>
      {sub && <span className="text-xs text-ink-2">{sub}</span>}
    </span>
  )
}

function RoasBar({ s, off }: { s: StoreStats; off: boolean }) {
  if (s.roas === null) return <span className="hatch inline-flex h-8 items-center rounded-lg px-3 text-sm text-ink-3">{off ? 'Meta not connected' : 'No ads running'}</span>
  if (s.economics === null) {
    return <div><p className="text-[1.3rem] @min-[50rem]:text-[1.125rem] @min-[60rem]:text-[1.3rem] font-bold text-revenue">{fmtX(s.roas)}</p><p className="text-xs text-warn">Breakeven needs a product cost</p></div>
  }
  if (!breaksEven(s.economics)) {
    return <div><p className="text-[1.3rem] @min-[50rem]:text-[1.125rem] @min-[60rem]:text-[1.3rem] font-bold text-bad">{fmtX(s.roas)}</p><p className="text-xs text-bad">{noBreakevenText(s.economics)}</p></div>
  }
  return <RoasTrack roas={s.roas} be={s.economics.breakevenRoas} target={s.economics.targetRoas} zone={s.zone} losing={s.contribution < 0} />
}

/** VXP's blended ROAS against its own breakeven: the stores' breakevens weighted by revenue, plus fixed costs. */
function VxpRoas({ total }: { total: Portfolio['total'] }) {
  if (total.roas === null) return <span className="text-ink-3">No ads</span>
  const blended = <span className="text-sm font-medium text-ink-3"> blended</span>
  const b = total.breakeven
  if (b === null) return <p className="text-[1.3rem] @min-[50rem]:text-[1.125rem] @min-[60rem]:text-[1.3rem] font-bold text-revenue">{fmtX(total.roas)}{blended}</p>
  if (!breaksEven(b)) {
    return (
      <div>
        <p className="text-[1.3rem] @min-[50rem]:text-[1.125rem] @min-[60rem]:text-[1.3rem] font-bold text-bad">{fmtX(total.roas)}{blended}</p>
        <p className="text-xs text-bad">{b.fixedCosts > 0 ? `Profit before ads can’t cover ${inr(b.fixedCosts)} fixed costs` : 'No ROAS breaks even'}</p>
      </div>
    )
  }
  const note = [b.fixedOnRecord ? `BE incl. ${inr(b.fixedCosts)} fixed costs` : 'No fixed costs on record', b.leftOut.length ? `Incomplete: ${b.leftOut.join(', ')} has no cost` : null]
  return <RoasTrack roas={total.roas} be={b.breakevenRoas} target={b.targetRoas} zone={total.zone} after={blended} note={note.filter(Boolean).join(' · ')} />
}

/** One word per store, from where its ROAS sits against breakeven and target. */
function CallChip({ s, off }: { s: StoreStats; off: boolean }) {
  const [word, cls] =
    s.roas === null ? [off ? 'No data' : 'No ads', 'text-ink-3 ring-line-strong']
    : s.economics === null ? ['Add cost', 'text-warn ring-warn/40 bg-warn/10']
    // A store losing money this period never reads a calm Hold, even when its ROAS sits on the product breakeven.
    : !breaksEven(s.economics) || s.zone === 'below' || s.contribution < 0 ? ['Cut or fix', 'text-bad ring-bad/40 bg-bad/12']
    : s.zone === 'profit' ? ['Scale', 'bg-lime text-on-lime ring-lime']
    : ['Hold', 'text-ink bg-raised-2 ring-[#33383d]']
  return <span className={`inline-flex h-8 min-w-[5.25rem] items-center justify-center whitespace-nowrap rounded-lg px-3 text-sm font-semibold ring-1 ${cls}`}>{word}</span>
}

const TONE = {
  bad: { Icon: TrendingDown, cls: 'text-bad', word: 'Problem' },
  warn: { Icon: AlertTriangle, cls: 'text-warn', word: 'Warning' },
  good: { Icon: TrendingUp, cls: 'text-good', word: 'Good' },
} as const
const TILE = { bad: 'bg-bad/14', warn: 'bg-warn/14', good: 'bg-lime/14' } as const

function Calls({ calls, view }: { calls: Call[]; view: ViewState }) {
  return (
    <section aria-labelledby="calls-h" className="glass rise p-2 [--delay:140ms]">
      <h2 id="calls-h" className="px-3 pt-2 text-lg font-bold">Needs your call</h2>
      {calls.length === 0 ? (
        <p className="mt-3 flex items-start gap-2 px-3 pb-2 text-ink-2"><span className="flex h-lh shrink-0 items-center"><CircleCheck className="size-4 text-good" aria-hidden /></span>Nothing needs you today.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {calls.map((c) => {
            const { Icon, cls, word } = TONE[c.tone]
            const body = (
              <>
                <span className={`inline-flex size-7 shrink-0 items-center justify-center rounded-lg ${TILE[c.tone]}`}><Icon className={`size-4 ${cls}`} aria-hidden /></span>
                <span className="sr-only">{word}: </span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{c.title}</span>
                  <span className="text-ink-2"> — {c.detail.split(/([+−-]?₹[\d,]+(?:\.\d+)?)/g).map((part, i) =>
                    i % 2 ? <span key={i} className="whitespace-nowrap">{part}</span> : part
                  )}</span>
                </span>
                {c.storeId && <span className="-ml-1 flex h-lh shrink-0 items-center"><ChevronRight className="size-3.5 text-ink-3" aria-hidden /></span>}
              </>
            )
            return (
              <li key={c.id}>
                {c.storeId
                  ? <Link href={href('/', { ...view, store: c.storeId })} data-s={c.storeId} className="glass-row flex items-start gap-3 px-3 py-2.5 leading-7">{body}</Link>
                  : <div className="glass-row flex items-start gap-3 px-3 py-2.5 leading-7">{body}</div>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function BottomLine({ m, view, period }: { m: Metrics; view: ViewState; period: Period }) {
  const c = m.cash()
  const cashDetails = c ? [
    c.bank && c.coversDays !== null ? `covers ${Math.floor(c.coversDays)} days of spend` : '',
    c.missing.length ? `without ${c.missing.join(' and ')}` : '',
  ].filter(Boolean).join(' · ') : ''
  const g = m.gst()
  const share = m.ownerShare()
  const month = (iso: string) => new Date(`${iso}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' })
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const meta = (a: string, b: string) => <span className="hidden text-xs leading-snug text-ink-3 xl:block">{a}<br />{b}</span>
  const moneyHref = href('/money', view)
  const item = 'glass-row flex min-w-0 items-start gap-3 px-4 py-3.5 text-lg'
  const iconBox = 'inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-raised-2 text-ink-2'
  const moneyLink = (label: string) => <Link href={moneyHref} aria-label={`${label} on Money`} className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink">On Money <span aria-hidden className="text-sm">→</span></Link>
  return (
    <section aria-label="Cash, GST and partner share" className="glass grid gap-2 p-2 sm:gap-2.5 sm:p-2.5 md:grid-cols-3">
      <Link href={moneyHref} className={item}>
        <span className={iconBox}><Wallet className="size-4" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          {c ? <>
            <span className="block"><span className="font-semibold">Cash</span> <span className="whitespace-nowrap font-bold tabular-nums">{inr(c.total)}</span></span>
            <span className="block text-sm text-ink-2">{cashDetails || 'cash on hand'}</span>
          </> : <span className="text-ink-3">Cash connects in a later stage</span>}
        </span>
        {meta(`Period: ${period.short}`, 'Source: cash ledger')}
      </Link>
      <div className={item}>
        <span className={iconBox}><FileText className="size-4" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          {g ? <>
            <span className="block"><span className="font-semibold">GST {month(g.month)}</span> <span className="whitespace-nowrap font-bold tabular-nums">{inr(g.owed)}</span></span>
            <span className="block text-sm text-ink-2">{g.partial ? 'so far · ' : ''}due {day(g.dueDate)}</span>
          </> : <><span className="block font-semibold">GST</span>{moneyLink('GST')}</>}
        </span>
        {g && meta(`Period: ${month(g.month)}`, 'Source: GST ledger')}
      </div>
      <div className={item}>
        <span className={iconBox}><PieChart className="size-4" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          {share ? <><span className="font-semibold">Per partner (50%) this month</span> <span className={`whitespace-nowrap font-bold tabular-nums ${tone(share.share)}`}>{share.share > 0 ? '+' : ''}<Signed value={share.share} /></span></> : <><span className="block font-semibold">Partner share</span>{moneyLink('Partner share')}</>}
        </span>
        {share && meta('Period: this month', 'Source: monthly P&L')}
      </div>
    </section>
  )
}

/** "Cash, GST and partner share" with only the parts still missing, capitalised. */
export function laterParts(cash: boolean, gst: boolean, share: boolean): string {
  const parts = [cash && 'cash', gst && 'GST', share && 'partner share'].filter((p): p is string => !!p)
  const s = parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** The store page's "no cost on record" warning, for every store at once; null when every order line has a cost. */
export function missingCosts(stores: StoreStats[]): string | null {
  const hit = stores.filter((s) => s.ordersMissingCogs > 0)
  if (hit.length === 0) return null
  const parts = hit.map((s) => `${s.store.name} ${s.ordersMissingCogs} ${s.ordersMissingCogs === 1 ? 'order' : 'orders'}`)
  return `Profit is overstated: ${parts.join(', ')} with a line that has no cost on record.`
}

/**
 * One plain sentence about which stores are paying for their ads. A store with uncosted orders only "looks" like it is.
 * A store whose ads Meta stopped (`stopped`, from its ads-stopped call) leads instead: past profit is not the news.
 */
export function verdict(stores: StoreStats[], notConnected: (id: StoreId) => boolean, stopped: StoreId[] = []): string {
  const halted = stores.filter((s) => stopped.includes(s.store.id))
  if (halted.length > 0) {
    const names = halted.map((s) => s.store.name)
    const who = names.length === 1 ? `${names[0]}’s` : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}’s`
    const rest = stores.filter((s) => !halted.includes(s) && s.spend > 0)
    return `${who} ads stopped.${rest.length > 0 ? ` ${verdict(rest, notConnected)}` : ''}`
  }
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
