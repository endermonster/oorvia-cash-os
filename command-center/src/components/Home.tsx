import Link from 'next/link'
import { AlertTriangle, ChevronRight, CircleCheck, FileText, PieChart, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { breaksEven, noBreakevenText } from '@/lib/calculator'
import { fmtX, inr, pct, type Call, type Metrics, type Period, type Portfolio, type StoreStats } from '@/lib/metrics'
import { href, type ViewState } from '@/lib/nav'
import { istNow } from '@/lib/dates'
import type { StoreId } from '@/lib/types'
import { Delta, rateSourceNote, Signed, StoreDot, tone } from './bits'
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
  const orders = m.recentOrders(ids, 60)
  const series = m.series(ids, period)
  const end = series.at(-1)
  const { net, prevNet, fixedCosts } = pf.total

  return (
    <main className={`${pageFrame} space-y-3 pb-6 pt-3`}>
      <Overview total={pf.total} series={series} period={period} nowHour={istNow(now).hour} prevHoursComplete={m.yesterdayHoursComplete(ids)} />

      {/* The verdict leads; the numbers behind it sit to its right. */}
      <section aria-label="Verdict" className="glass rise grid gap-x-8 gap-y-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div className="min-w-0 lg:self-center">
          <h1 className="text-balance text-[clamp(1.5rem,2.2vw,2.1rem)] font-extrabold leading-[1.12] tracking-[-0.025em]">{verdict(pf.stores, m.metaNotConnected, stopped)}</h1>
          {missing && <p className="mt-1 max-w-[75ch] text-[0.8125rem] text-warn">{missing}</p>}
        </div>
        <div className="border-line lg:border-l lg:pl-8">
          <p className="label">Projected profit · {period.short} · All stores</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className={`whitespace-nowrap text-[2.6rem] font-extrabold leading-none tracking-[-0.035em] ${tone(net)}`}>{net > 0 ? '+' : ''}<Signed value={net} /></p>
            {prevNet > 0
              ? <Delta now={net} prev={prevNet} suffix={`vs ${period.prevLabel}`} />
              : <span className="text-sm text-ink-3">vs {inr(prevNet)} {period.prevLabel}</span>}
          </div>
          {/* w-0 min-w-full: the note wraps to the column instead of widening it and squeezing the verdict. */}
          {fixedCosts > 0 && <p className="mt-1 w-0 min-w-full text-xs text-ink-2">After {inr(fixedCosts)} fixed costs at run rate</p>}
          {rateNote && <p className="mt-0.5 w-0 min-w-full text-xs text-ink-3">Estimate · {rateNote}</p>}
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
          <Calls calls={calls} view={view} />
          <section aria-labelledby="pace-h" className="glass flex flex-col px-5 pb-3 pt-4 lg:flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <h2 id="pace-h" className="text-lg font-bold">Cumulative revenue vs spend <span className="block text-sm font-medium text-ink-3 sm:ml-2 sm:inline">{period.short} · Shopify + Meta</span></h2>
              <p className="flex items-center gap-5 text-sm text-ink-2">
                <span className="flex items-center gap-2"><span aria-hidden className="h-[3px] w-5 rounded-full bg-revenue" /><span>Revenue<span className="hidden sm:inline"> (cumulative)</span>{end && <span className="font-semibold text-revenue sm:hidden"> {inr(end.cumRevenue)}</span>}</span></span>
                <span className="flex items-center gap-2"><span aria-hidden className="h-[3px] w-5 rounded-full bg-spend" /><span>Spend<span className="hidden sm:inline"> (cumulative)</span>{end && <span className={`whitespace-nowrap font-semibold sm:hidden ${end.cumSpend === 0 ? 'text-ink-2' : 'text-spend'}`}> {inr(end.cumSpend)}</span>}</span></span>
              </p>
            </div>
            <div className={`mt-3 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${end?.cumSpend === 0 ? '[&_.text-spend]:text-ink-2' : ''}`}>
              <RevenueChart points={series} unit={period.id === 'today' ? 'hour' : 'day'} />
            </div>
          </section>
        </div>

        <section aria-labelledby="map-h" className="glass flex min-w-0 flex-col p-2">
          <div className="flex items-center justify-between gap-4 px-3 pt-2">
            <h2 id="map-h" className="text-lg font-bold">Orders across India</h2>
            <p className="flex items-center gap-4 text-sm text-ink-2">
              <span className="flex items-center gap-2"><span aria-hidden className="size-2 rounded-full bg-prepaid" />Prepaid</span>
              <span className="flex items-center gap-2"><span aria-hidden className="size-2 rounded-full bg-cod" />COD</span>
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

export function codShareLabel({ orders, codOrders, unknownPayOrders }: Pick<StoreStats, 'orders' | 'codOrders' | 'unknownPayOrders'>): string | undefined {
  const knownOrders = orders - unknownPayOrders
  return knownOrders > 0 ? `${pct(codOrders / knownOrders)} COD` : undefined
}

/** Cells share one first baseline, so a row's primary figures sit on one line and sub-lines hang below. */
const ROW = 'grid grid-cols-2 gap-x-4 @min-[50rem]:gap-x-3 @min-[60rem]:gap-x-4 gap-y-3 @min-[50rem]:content-center @min-[50rem]:items-baseline @min-[50rem]:gap-y-0 @min-[50rem]:grid-cols-[minmax(6.75rem,1.15fr)_minmax(4.5rem,1fr)_minmax(3.75rem,0.9fr)_minmax(9.5rem,1.9fr)_minmax(6.75rem,1.15fr)_minmax(5.5rem,1.1fr)_5.75rem] @min-[60rem]:grid-cols-[minmax(7.5rem,1.15fr)_minmax(4.5rem,1fr)_minmax(3.5rem,0.9fr)_minmax(10.5rem,1.9fr)_minmax(5rem,1.15fr)_minmax(5.5rem,1.1fr)_5.75rem] [grid-template-areas:"name_call"_"roas_roas"_"spend_orders"_"rev_profit"] @min-[50rem]:[grid-template-areas:"name_spend_orders_roas_rev_profit_call"]'

function Stores({ stores, total, view, period, notConnected }: { stores: StoreStats[]; total: Portfolio['total']; view: ViewState; period: Period; notConnected: (id: StoreId) => boolean }) {
  const head = 'label whitespace-nowrap leading-tight'
  const moneyHead = `${head} text-right`
  const src = (s: string) => <span className="block text-[0.6875rem] font-normal normal-case tracking-normal text-ink-3">{period.short} · {s}</span>
  // The total is the stores' sum less fixed costs at run rate, so it says so: the rows above add up to more.
  const fixed = total.fixedCosts
  return (
    <section aria-labelledby="stores-h" className="glass rise p-2 [--delay:80ms]">
      <h2 id="stores-h" className="sr-only">Stores</h2>
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
            <div role="row" key={s.store.id} className={`glass-row ${ROW} px-3 py-3 @min-[50rem]:min-h-[4.5rem] @min-[50rem]:py-2`}>
              <span role="cell" className="[grid-area:name]">
                <Link href={href('/', { ...view, store: s.store.id })} className="inline-flex min-h-9 items-center gap-2 text-[1.6rem] @min-[50rem]:text-[1.35rem] @min-[60rem]:text-[1.6rem] font-bold tracking-[-0.02em] hover:underline">
                  <StoreDot id={s.store.id} />{s.store.name}
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
          <div role="row" className={`glass-row ${ROW} px-3 py-3 @min-[50rem]:min-h-[4.5rem] @min-[50rem]:py-2`}>
            <span role="cell" className="text-[1.6rem] @min-[50rem]:text-[1.35rem] @min-[60rem]:text-[1.6rem] font-bold tracking-[-0.02em] [grid-area:name]">VXP <span className="text-lg font-medium text-ink-2">(total)</span></span>
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
  return <RoasTrack roas={s.roas} be={s.economics.breakevenRoas} target={s.economics.targetRoas} zone={s.zone} />
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
    s.roas === null ? [off ? 'No data' : 'No ads', 'text-ink-2 ring-line-strong']
    : s.economics === null ? ['Add cost', 'text-warn ring-warn/40 bg-warn/10']
    // A store losing money this period never reads a calm Hold, even when its ROAS sits on the product breakeven.
    : !breaksEven(s.economics) || s.zone === 'below' || s.contribution < 0 ? ['Cut or fix', 'text-bad ring-bad/45 bg-bad/12']
    : s.zone === 'profit' ? ['Scale', 'text-good ring-good/45 bg-good/12']
    : ['Hold', 'text-revenue ring-revenue/40 bg-revenue/10']
  return <span className={`inline-flex h-8 min-w-[5.25rem] items-center justify-center whitespace-nowrap rounded-lg px-3 text-sm font-semibold ring-1 ${cls}`}>{word}</span>
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
        <p className="mt-3 flex items-start gap-2 px-3 pb-2 text-ink-2"><span className="flex h-lh shrink-0 items-center"><CircleCheck className="size-4 text-good" aria-hidden /></span>Nothing needs you today.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {calls.map((c) => {
            const { Icon, cls, word } = TONE[c.tone]
            const body = (
              <>
                <span className="flex h-lh shrink-0 items-center"><Icon className={`size-4 ${cls}`} aria-hidden /></span>
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
                  ? <Link href={href('/', { ...view, store: c.storeId })} className="glass-row flex items-start gap-2 px-3 py-2.5">{body}</Link>
                  : <div className="glass-row flex items-start gap-2 px-3 py-2.5">{body}</div>}
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
  const item = 'flex min-w-0 items-start gap-2 px-3 py-3 text-lg'
  const iconBox = 'flex h-lh shrink-0 items-center text-ink-2'
  const moneyLink = (label: string) => <Link href={moneyHref} aria-label={`${label} on Money`} className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink">On Money <span aria-hidden className="text-sm">→</span></Link>
  return (
    <section aria-label="Cash, GST and partner share" className="glass grid gap-x-2 gap-y-1 p-2 md:grid-cols-3 md:divide-x md:divide-line">
      <Link href={moneyHref} className={`${item} rounded-xl hover:bg-raised/40`}>
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
