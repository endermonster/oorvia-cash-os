import Link from 'next/link'
import { AlertTriangle, ChevronRight, CircleCheck, FileText, PieChart, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { breaksEven, noBreakevenText } from '@/lib/calculator'
import { fmtX, inr, MIN_SAMPLE, pct, type Call, type Metrics, type Period, type Portfolio, type StoreStats } from '@/lib/metrics'
import { href, type ViewState } from '@/lib/nav'
import type { StoreId } from '@/lib/types'
import { Delta, Signed, StoreDot } from './bits'
import { LiveMap } from './LiveMap'
import { RevenueChart } from './RevenueChart'

export function HomeView({ view, period, m, now, mock }: { view: ViewState; period: Period; m: Metrics; now: Date; mock: boolean }) {
  const pf = m.portfolio(period)
  const ids = m.stores.map((s) => s.id)
  const resolved = m.resolvedCounts(ids, period)
  const borrowed = m.borrowedRates(undefined, period).map((s) => s.name)
  const missing = missingCosts(pf.stores)
  const orders = m.recentOrders(ids, 60)
  const series = m.series(ids, period)
  const end = series.at(-1)

  return (
    <main className="mx-auto max-w-[1536px] space-y-3 px-3 pb-6 pt-3 sm:px-4">
      {/* The verdict leads; the numbers behind it sit to its right. */}
      <section aria-label="Verdict" className="glass rise grid gap-x-8 gap-y-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div className="min-w-0 lg:self-center">
          <h1 className="text-balance text-[clamp(1.5rem,2.2vw,2.1rem)] font-extrabold leading-[1.12] tracking-[-0.025em]">{verdict(pf.stores, m.metaNotConnected)}</h1>
          {missing && <p className="mt-1 max-w-[75ch] text-[0.8125rem] text-warn">{missing}</p>}
        </div>
        <div className="border-line lg:border-l lg:pl-8">
          <p className="label">Projected profit · {period.short} · All stores</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className={`text-[2.6rem] font-extrabold leading-none tracking-[-0.035em] ${tone(pf.total.contribution)}`}>{pf.total.contribution > 0 ? '+' : ''}<Signed value={pf.total.contribution} /></p>
            {pf.total.prevContribution > 0
              ? <Delta now={pf.total.contribution} prev={pf.total.prevContribution} suffix={`vs ${period.prevLabel}`} />
              : <span className="text-sm text-ink-3">vs {inr(pf.total.prevContribution)} {period.prevLabel}</span>}
          </div>
          {/* w-0 min-w-full: the note wraps to the column instead of widening it and squeezing the verdict. */}
          {borrowed.length > 0 && <p className="mt-0.5 w-0 min-w-full text-xs text-ink-3">Estimate · {borrowed.join(', ')} on VXP delivery rates until {MIN_SAMPLE} resolve</p>}
        </div>
        <div className="border-line lg:border-l lg:pl-8">
          <p className="label">Resolved · {period.short} · vFulfill</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="text-[2.6rem] font-extrabold leading-none tracking-[-0.035em]">{resolved.delivered}<span className="ml-2 text-xl font-semibold tracking-normal text-ink-2">delivered</span></p>
            <span className="text-sm text-ink-2">{resolved.rto} RTO{resolved.rate !== null && <> · {pct(resolved.rate)} delivered</>}</span>
          </div>
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <Stores stores={pf.stores} total={pf.total} view={view} period={period} notConnected={m.metaNotConnected} />
          <Calls calls={m.calls(period)} view={view} />
          <section aria-labelledby="pace-h" className="glass flex flex-col px-5 pb-3 pt-4 lg:flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <h2 id="pace-h" className="text-lg font-bold">Cumulative revenue vs spend <span className="block text-sm font-medium text-ink-3 sm:ml-2 sm:inline">{period.short} · Shopify + Meta</span></h2>
              <p className="flex items-center gap-5 text-sm text-ink-2">
                <span className="flex items-center gap-2"><span aria-hidden className="h-[3px] w-5 rounded-full bg-revenue" /><span>Revenue<span className="hidden sm:inline"> (cumulative)</span>{end && <span className="font-semibold text-revenue sm:hidden"> {inr(end.cumRevenue)}</span>}</span></span>
                <span className="flex items-center gap-2"><span aria-hidden className="h-[3px] w-5 rounded-full bg-spend" /><span>Spend<span className="hidden sm:inline"> (cumulative)</span>{end && <span className="font-semibold text-spend sm:hidden"> {inr(end.cumSpend)}</span>}</span></span>
              </p>
            </div>
            <div className="mt-3 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <RevenueChart points={series} unit={period.id === 'today' ? 'hour' : 'day'} />
            </div>
          </section>
        </div>

        <section aria-labelledby="map-h" className="glass flex min-w-0 flex-col p-2">
          <div className="flex items-center justify-between gap-4 px-3 pt-2">
            <h2 id="map-h" className="text-lg font-bold">Orders across India</h2>
            <p className="flex items-center gap-4 text-sm text-ink-2">
              <span className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-full bg-prepaid" />Prepaid</span>
              <span className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-full bg-cod" />COD</span>
            </p>
          </div>
          <div className="mt-3 flex min-h-0 flex-1 flex-col">
            <LiveMap initial={orders} stores={m.stores.map((s) => ({ id: s.id, name: s.name }))} serverNow={now.toISOString()} mock={mock} view={view} />
          </div>
        </section>
      </div>

      <BottomLine m={m} view={view} period={period} />
    </main>
  )
}

/** Gain green, loss red, zero plain: ₹0 is not a gain. */
const tone = (n: number) => (n > 0 ? 'text-good' : n < 0 ? 'text-bad' : 'text-ink-2')

/** Cells share one first baseline, so a row's primary figures sit on one line and sub-lines hang below. */
const ROW = 'grid grid-cols-2 gap-x-4 @min-[50rem]:gap-x-3 @min-[60rem]:gap-x-4 gap-y-3 @min-[50rem]:content-center @min-[50rem]:items-baseline @min-[50rem]:gap-y-0 @min-[50rem]:grid-cols-[minmax(6.75rem,1.15fr)_minmax(4.5rem,1fr)_minmax(3.75rem,0.9fr)_minmax(9.5rem,1.9fr)_minmax(6.75rem,1.15fr)_minmax(5.5rem,1.1fr)_5.75rem] @min-[60rem]:grid-cols-[minmax(7.5rem,1.15fr)_minmax(4.5rem,1fr)_minmax(3.5rem,0.9fr)_minmax(10.5rem,1.9fr)_minmax(5rem,1.15fr)_minmax(5.5rem,1.1fr)_5.75rem] [grid-template-areas:"name_call"_"roas_roas"_"spend_orders"_"rev_profit"] @min-[50rem]:[grid-template-areas:"name_spend_orders_roas_rev_profit_call"]'

function Stores({ stores, total, view, period, notConnected }: { stores: StoreStats[]; total: Portfolio['total']; view: ViewState; period: Period; notConnected: (id: StoreId) => boolean }) {
  const head = 'label whitespace-nowrap leading-tight'
  const src = (s: string) => <span className="block text-[0.6875rem] font-normal normal-case tracking-normal text-ink-3">{period.short} · {s}</span>
  return (
    <section aria-labelledby="stores-h" className="glass rise p-2 [--delay:80ms]">
      <h2 id="stores-h" className="sr-only">Stores</h2>
      <div role="table" aria-label="Stores" className="@container">
        <div role="row" className={`${ROW} hidden px-3 pb-2 pt-2 @min-[50rem]:grid`}>
          <span role="columnheader" className={`${head} [grid-area:name]`}>Store</span>
          <span role="columnheader" className={`${head} [grid-area:spend]`}>Spend{src('Meta')}</span>
          <span role="columnheader" className={`${head} [grid-area:orders]`}>Orders{src('Shopify')}</span>
          <span role="columnheader" className={`${head} [grid-area:roas]`}>ROAS vs breakeven{src('Meta')}</span>
          <span role="columnheader" className={`${head} [grid-area:rev]`}>Booked revenue{src('Shopify')}</span>
          <span role="columnheader" className={`${head} [grid-area:profit]`}>Profit (est.){src('Estimate')}</span>
          <span role="columnheader" className={`${head} [grid-area:call] text-center`}>Call</span>
        </div>
        <div className="space-y-1.5">
          {stores.map((s) => (
            <div role="row" key={s.store.id} className={`glass-row ${ROW} px-3 py-3 @min-[50rem]:min-h-[4.5rem] @min-[50rem]:py-2`}>
              <span role="cell" className="[grid-area:name]">
                <Link href={href('/', { ...view, store: s.store.id })} className="flex items-center gap-2.5 text-[1.6rem] @min-[50rem]:text-[1.35rem] @min-[60rem]:text-[1.6rem] font-bold tracking-[-0.02em] hover:underline">
                  <StoreDot id={s.store.id} size={9} />{s.store.name}
                </Link>
              </span>
              <Cell area="spend" label="Spend" value={inr(s.spend)} />
              <Cell area="orders" label="Orders" value={String(s.orders)} sub={s.orders ? `${pct(s.codOrders / s.orders)} COD` : undefined} />
              <span role="cell" className="[grid-area:roas]"><RoasBar s={s} off={notConnected(s.store.id)} /></span>
              <Cell area="rev" label="Booked revenue" value={inr(s.revenue)} />
              <span role="cell" className="[grid-area:profit]">
                <span className="text-xs text-ink-3 @min-[50rem]:hidden">Profit (est.) </span>
                <span className={`block whitespace-nowrap text-[1.3rem] @min-[50rem]:text-[1.125rem] @min-[60rem]:text-[1.3rem] font-bold ${tone(s.contribution)}`}>{s.contribution > 0 ? '+' : ''}<Signed value={s.contribution} /></span>
                {s.contribution < 0 && <span className="text-xs text-bad">loss this period</span>}
              </span>
              <span role="cell" className="flex justify-end [grid-area:call] @min-[50rem]:justify-center"><CallChip s={s} off={notConnected(s.store.id)} /></span>
            </div>
          ))}
          <div role="row" className={`glass-row ${ROW} px-3 py-3 @min-[50rem]:min-h-[4.5rem] @min-[50rem]:py-2`}>
            <span role="cell" className="text-[1.6rem] @min-[50rem]:text-[1.35rem] @min-[60rem]:text-[1.6rem] font-bold tracking-[-0.02em] [grid-area:name]">VXP <span className="text-lg font-medium text-ink-2">(total)</span></span>
            <Cell area="spend" label="Spend" value={inr(total.spend)} />
            <Cell area="orders" label="Orders" value={String(total.orders)} />
            <span role="cell" className="[grid-area:roas]"><VxpRoas total={total} /></span>
            <Cell area="rev" label="Booked revenue" value={inr(total.revenue)} />
            <span role="cell" className="[grid-area:profit]">
              <span className="text-xs text-ink-3 @min-[50rem]:hidden">Profit (est.) </span>
              <span className={`block whitespace-nowrap text-[1.3rem] @min-[50rem]:text-[1.125rem] @min-[60rem]:text-[1.3rem] font-bold ${tone(total.contribution)}`}>{total.contribution > 0 ? '+' : ''}<Signed value={total.contribution} /></span>
            </span>
            <span role="cell" aria-hidden className="[grid-area:call]" />
          </div>
        </div>
      </div>
    </section>
  )
}

function Cell({ area, label, value, sub }: { area: string; label: string; value: string; sub?: string }) {
  return (
    <span role="cell" className="min-w-0" style={{ gridArea: area }}>
      <span className="text-xs text-ink-3 @min-[50rem]:hidden">{label} </span>
      <span className="block text-[1.3rem] @min-[50rem]:text-[1.125rem] @min-[60rem]:text-[1.3rem] font-bold leading-tight">{value}</span>
      {sub && <span className="text-xs text-ink-2">{sub}</span>}
    </span>
  )
}

function RoasBar({ s, off }: { s: StoreStats; off: boolean }) {
  if (s.roas === null) return <span className="text-lg text-ink-2">{off ? 'Meta not connected' : 'No ads'}</span>
  if (s.economics === null) {
    return <div><p className="text-[1.3rem] @min-[50rem]:text-[1.125rem] @min-[60rem]:text-[1.3rem] font-bold text-revenue">{fmtX(s.roas)}</p><p className="text-xs text-warn">Breakeven needs a product cost</p></div>
  }
  if (!breaksEven(s.economics)) {
    return <div><p className="text-[1.3rem] @min-[50rem]:text-[1.125rem] @min-[60rem]:text-[1.3rem] font-bold text-bad">{fmtX(s.roas)}</p><p className="text-xs text-bad">{noBreakevenText(s.economics)}</p></div>
  }
  return <Bar roas={s.roas} be={s.economics.breakevenRoas} target={s.economics.targetRoas} zone={s.zone} />
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
  const note = [b.fixedOnRecord ? `Incl. ${inr(b.fixedCosts)} fixed costs` : 'No fixed costs on record', b.leftOut.length ? `Incomplete: ${b.leftOut.join(', ')} has no cost` : null]
  return <Bar roas={total.roas} be={b.breakevenRoas} target={b.targetRoas} zone={total.zone} after={blended} note={note.filter(Boolean).join(' · ')} />
}

function Bar({ roas, be, target, zone, after, note }: { roas: number; be: number; target: number; zone: StoreStats['zone']; after?: React.ReactNode; note?: string }) {
  const max = Math.max(target * 1.12, roas * 1.05)
  const at = (v: number) => `${(v / max) * 100}%`
  const fill = zone === null ? 'bg-ink-3' : zone === 'below' ? 'bg-bad' : zone === 'profit' ? 'bg-good' : 'bg-revenue'
  const word = zone === null ? 'Breakeven incomplete' : zone === 'below' ? 'Below breakeven' : zone === 'covering' ? 'Covering costs' : 'Above target'
  return (
    <div title={`${word}: breakeven ${fmtX(be)}, target ${fmtX(target)}${note ? `. ${note}` : ''}`}>
      <p className={`text-[1.3rem] @min-[50rem]:text-[1.125rem] @min-[60rem]:text-[1.3rem] font-bold leading-tight ${zone === null ? 'text-ink-2' : zone === 'below' ? 'text-bad' : 'text-revenue'}`}>{fmtX(roas)}{after}<span className="sr-only"> {word}</span></p>
      <div className="relative mt-1.5 h-2 rounded-full bg-[rgb(150_180_225/0.16)]">
        <div className={`absolute inset-y-0 left-0 rounded-full ${fill}`} style={{ width: at(roas) }} />
        {/* Dark edge keeps a tick visible when the fill of the same colour runs past it. */}
        <span aria-hidden className="absolute -top-1 h-4 w-0.5 rounded bg-bad shadow-[0_0_0_1px_rgb(6_10_19/0.85)]" style={{ left: at(be) }} />
        <span aria-hidden className="absolute -top-1 h-4 w-0.5 rounded bg-good shadow-[0_0_0_1px_rgb(6_10_19/0.85)]" style={{ left: at(target) }} />
      </div>
      {/* A key, not labels on the ticks: the two ticks sit ~60px apart, too close for two centred labels to fit. */}
      <div className="mt-1.5 flex items-center justify-between gap-3 whitespace-nowrap text-[0.6875rem] leading-none">
        <span className="flex items-center gap-1.5 text-ink-2"><span aria-hidden className="h-2.5 w-0.5 rounded bg-bad" />BE {fmtX(be)}</span>
        <span className="flex items-center gap-1.5 text-ink-2"><span aria-hidden className="h-2.5 w-0.5 rounded bg-good" />Target {fmtX(target)}</span>
      </div>
      {note && <p className="mt-1 truncate text-[0.6875rem] leading-tight text-ink-3">{note}</p>}
    </div>
  )
}

/** One word per store, from where its ROAS sits against breakeven and target. */
function CallChip({ s, off }: { s: StoreStats; off: boolean }) {
  const [word, cls] =
    s.roas === null ? [off ? 'No data' : 'No ads', 'text-ink-2 ring-line-strong']
    : s.economics === null ? ['Add cost', 'text-warn ring-warn/40 bg-warn/10']
    : !breaksEven(s.economics) || s.zone === 'below' ? ['Cut or fix', 'text-bad ring-bad/45 bg-bad/12']
    : s.zone === 'profit' ? ['Scale', 'text-good ring-good/45 bg-good/12']
    : ['Hold', 'text-revenue ring-revenue/40 bg-revenue/10']
  return <span className={`inline-block min-w-[5.25rem] whitespace-nowrap rounded-lg px-3 py-1.5 text-center text-sm font-semibold ring-1 ${cls}`}>{word}</span>
}

const TONE = {
  bad: { Icon: TrendingDown, cls: 'text-bad', word: 'Problem' },
  warn: { Icon: AlertTriangle, cls: 'text-warn', word: 'Warning' },
  good: { Icon: TrendingUp, cls: 'text-good', word: 'Good' },
} as const

function Calls({ calls, view }: { calls: Call[]; view: ViewState }) {
  return (
    <section aria-labelledby="calls-h" className="glass rise p-2 [--delay:140ms]">
      <h2 id="calls-h" className="px-3 pt-2 text-lg font-bold">Needs your call</h2>
      {calls.length === 0 ? (
        <p className="mt-3 flex items-center gap-3 px-3 pb-2 text-ink-2"><CircleCheck className="size-5 text-good" aria-hidden />Nothing needs you today.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {calls.map((c) => {
            const { Icon, cls, word } = TONE[c.tone]
            const body = (
              <>
                <Icon className={`size-[1.15rem] shrink-0 ${cls}`} aria-hidden /><span className="sr-only">{word}: </span>
                <span className="min-w-0 flex-1 md:truncate"><span className="font-semibold">{c.title}</span><span className="text-ink-2"> — {c.detail}</span></span>
                {c.storeId && <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />}
              </>
            )
            return (
              <li key={c.id}>
                {c.storeId
                  ? <Link href={href('/', { ...view, store: c.storeId })} className="glass-row flex items-center gap-3 px-3 py-2.5">{body}</Link>
                  : <div className="glass-row flex items-center gap-3 px-3 py-2.5">{body}</div>}
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
  const g = m.gst()
  const share = m.ownerShare()
  const month = (iso: string) => new Date(`${iso}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' })
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const meta = (a: string, b: string) => <span className="hidden text-xs leading-snug text-ink-3 xl:block">{a}<br />{b}</span>
  const item = 'flex min-w-0 items-center gap-3.5 px-3 py-3'
  return (
    <section aria-label="Cash, GST and your share" className="glass grid gap-x-2 gap-y-1 p-2 md:grid-cols-3 md:divide-x md:divide-line">
      <Link href={href('/money', view)} className={`${item} rounded-xl hover:bg-white/[0.04]`}>
        <Wallet className="size-6 shrink-0 text-ink-2" aria-hidden />
        <span className="min-w-0 flex-1">
          {c ? <>
            <span className="block text-lg"><span className="font-semibold">Cash</span> <span className="font-bold">{inr(c.total)}</span></span>
            <span className="block text-sm text-ink-2">{c.bank && c.coversDays !== null ? `covers ${Math.floor(c.coversDays)} days of spend` : c.missing.length ? `without ${c.missing.join(' and ')}` : 'cash on hand'}</span>
          </> : <span className="text-ink-3">Cash connects in a later stage</span>}
        </span>
        {meta(`Period: ${period.short}`, 'Source: cash ledger')}
      </Link>
      <div className={item}>
        <FileText className="size-6 shrink-0 text-ink-2" aria-hidden />
        <span className="min-w-0 flex-1">
          {g ? <>
            <span className="block text-lg"><span className="font-semibold">GST {month(g.month)}</span> <span className="font-bold">{inr(g.owed)}</span></span>
            <span className="block text-sm text-ink-2">due {day(g.dueDate)}</span>
          </> : <span className="text-ink-3">GST connects in a later stage</span>}
        </span>
        {g && meta(`Period: ${month(g.month)}`, 'Source: GST ledger')}
      </div>
      <div className={item}>
        <PieChart className="size-6 shrink-0 text-ink-2" aria-hidden />
        <span className="min-w-0 flex-1 text-lg">
          {share ? <><span className="font-semibold">Your share (50%) this month</span> <span className={`font-bold ${tone(share.share)}`}>{share.share > 0 ? '+' : ''}<Signed value={share.share} /></span></> : <span className="text-base text-ink-3">Your share connects in a later stage</span>}
        </span>
        {share && meta('Period: this month', 'Source: profit model')}
      </div>
    </section>
  )
}

/** "Cash, GST and your share" with only the parts still missing, capitalised. */
export function laterParts(cash: boolean, gst: boolean, share: boolean): string {
  const parts = [cash && 'cash', gst && 'GST', share && 'your share'].filter((p): p is string => !!p)
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
