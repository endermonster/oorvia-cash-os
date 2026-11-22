import Link from 'next/link'
import { Suspense } from 'react'
import { AdsStatsRow, AdsVerdict, CampaignsTable, DailyTable, StoreAdsTable } from '@/components/AdsParts'
import { Skeleton } from '@/components/Skeleton'
import { TopBar } from '@/components/TopBar'
import { campaignStats, dailyAds, monthDays, sortCampaigns, SORTS, spendWeightedBreakeven, storeAds, type SortKey, type StoreAds } from '@/lib/ads'
import { loadAds } from '@/lib/ads-load'
import { getData } from '@/lib/data'
import { createMetrics, type PeriodId } from '@/lib/metrics'
import { readView } from '@/lib/nav'
import { shiftMonth } from '@/lib/orders'
import type { StoreId } from '@/lib/types'

export default function Page({ searchParams }: PageProps<'/ads'>) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Ads searchParams={searchParams} />
    </Suspense>
  )
}

type Raw = Record<string, string | string[] | undefined>
const one = (p: Raw, k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '')
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const shortMonth = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' })
const monthSegment = 'inline-flex h-[30px] items-center gap-1 whitespace-nowrap rounded-[0.6rem] px-2 text-ink-2'

function MonthName({ month }: { month: string }) {
  return <><span className="sm:hidden">{shortMonth(month)}</span><span className="hidden sm:inline">{monthLabel(month)}</span></>
}

async function Ads({ searchParams }: { searchParams: PageProps<'/ads'>['searchParams'] }) {
  const d = await getData()
  const params = await searchParams
  const view = readView(params, d.stores)
  const m = createMetrics(d)
  const current = d.today.slice(0, 7)
  // A past month is the Month period with ?month=; any other period ignores it, so the top bar's presets still work.
  const asked = one(params, 'month')
  const pastMonth = view.period === 'month' && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) && asked < current ? asked : null
  const period = m.resolvePeriod(view.period)
  const { from, to } = pastMonth ? monthDays(pastMonth) : period
  const sort: SortKey = SORTS.includes(one(params, 'sort') as SortKey) ? (one(params, 'sort') as SortKey) : 'spend'
  const storeIds: StoreId[] = view.store === 'all' ? d.stores.map((s) => s.id) : [view.store]
  const storeName = (id: string) => d.stores.find((s) => s.id === id)?.name ?? id

  /** This page's URL; store carries over, and the month and sort unless changed. */
  const link = (over: { period?: PeriodId; month?: string | null; sort?: SortKey }) => {
    const q = new URLSearchParams()
    if (view.store !== 'all') q.set('store', view.store)
    const p = over.period ?? view.period
    if (p !== '7d') q.set('period', p)
    const mo = 'month' in over ? over.month : pastMonth
    if (p === 'month' && mo && mo < current) q.set('month', mo)
    const s = over.sort ?? sort
    if (s !== 'spend') q.set('sort', s)
    const str = q.toString()
    return str ? `/ads?${str}` : '/ads'
  }
  const shown = pastMonth ?? current
  const prevMonth = shiftMonth(pastMonth ?? current, -1)
  const nextMonth = pastMonth ? shiftMonth(pastMonth, 1) : null
  const rangeLabel = pastMonth ? monthLabel(pastMonth) : view.period === 'month' ? `${monthLabel(current)} so far` : period.range

  // Switching store keeps the month and sort (the top bar's links to /ads carry them).
  const keep: Record<string, string> = {}
  if (pastMonth) keep.month = pastMonth
  if (sort !== 'spend') keep.sort = sort

  let data: Awaited<ReturnType<typeof loadAds>> | null = null
  let error: string | null = null
  if (d.source === 'supabase') {
    try {
      data = await loadAds(from, to, storeIds, d.products)
    } catch (e) {
      console.error(`ads: ${e instanceof Error ? e.message : String(e)}`)
      error = 'Ads could not be loaded. Try again; if it keeps failing, check the server log.'
    }
  }

  const economics = (storeId: StoreId, sku: string) => m.skuEconomics(storeId, sku)
  const camps = data ? sortCampaigns(campaignStats(data.campaigns, data.days, data.orders, economics), sort) : []
  // A past month's breakeven is over that month's products (by spend); the presets use today's mix, as Home does.
  const storeBe = (id: StoreId) => (pastMonth ? spendWeightedBreakeven(camps, id) ?? m.storeEconomics(id) : m.storeEconomics(id))
  const stores = data ? storeAds(storeIds, data.campaigns, data.days, data.orders, storeBe) : []
  const days = data ? dailyAds(from, to, data.days, data.orders) : []
  const total = stores.reduce<Omit<StoreAds, 'storeId' | 'be' | 'zone'>>((t, s) => ({
    spendPaise: t.spendPaise + s.spendPaise, impressions: t.impressions + s.impressions, clicks: t.clicks + s.clicks,
    metaPurchases: t.metaPurchases + s.metaPurchases, orders: t.orders + s.orders, revenuePaise: t.revenuePaise + s.revenuePaise,
    trackedOrders: t.trackedOrders + s.trackedOrders, roas: null, cpa: null,
  }), { spendPaise: 0, impressions: 0, clicks: 0, metaPurchases: 0, orders: 0, revenuePaise: 0, trackedOrders: 0, roas: null, cpa: null })
  total.roas = total.spendPaise > 0 ? total.revenuePaise / total.spendPaise : null
  total.cpa = total.orders > 0 ? total.spendPaise / 100 / total.orders : null
  const single = view.store !== 'all'
  const notConnected = storeIds.filter((id) => m.metaNotConnected(id)).map(storeName)
  const be = single ? stores[0]?.be ?? null : null
  // Stores losing money this period, from the same profit estimate Home uses; a past month has no such estimate.
  const losing: StoreId[] = pastMonth ? [] : m.portfolio(period, storeIds).stores.filter((s) => s.contribution < 0).map((s) => s.store.id)
  const short = view.period === 'month' ? shortMonth(shown) : period.short
  const months = (
    <nav aria-label="Month" className="glass-pill ml-auto inline-flex p-[3px] text-sm">
      <Link href={link({ period: 'month', month: prevMonth })} aria-label={`Previous month, ${monthLabel(prevMonth)}`} className={`${monthSegment} hover:text-ink`}>‹ <MonthName month={prevMonth} /></Link>
      <span className={`${monthSegment} ${view.period === 'month' ? 'glass-pill-on font-semibold text-ink' : ''}`}><MonthName month={shown} /></span>
      {nextMonth && <Link href={link({ period: 'month', month: nextMonth })} aria-label={`Next month, ${monthLabel(nextMonth)}`} className={`${monthSegment} hover:text-ink`}><MonthName month={nextMonth} /> ›</Link>}
    </nav>
  )

  return (
    <>
      <TopBar tab="ads" view={{ ...view, keep: { path: '/ads', params: keep } }} d={d} />
      <main className="mx-auto max-w-[1536px] space-y-3 px-3 pb-6 pt-3 sm:px-4">
        {d.source !== 'supabase' || error || !data ? (
          <section className="glass px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="label">Ads · {rangeLabel} · {single ? storeName(view.store) : 'All VXP'}</h1>
              {months}
            </div>
            <p className="mt-3 text-ink-2">{d.source !== 'supabase' ? 'Ads reads real data only: set DATA_SOURCE=supabase.' : error}</p>
          </section>
        ) : (
          <>
            <AdsVerdict t={total} be={be} single={single} rows={camps} range={rangeLabel} period={short} scope={single ? storeName(view.store) : 'All VXP'} months={months} notConnected={notConnected} allDisconnected={notConnected.length === storeIds.length} />
            <AdsStatsRow t={total} be={be} single={single} period={short} />
            {!single && <StoreAdsTable rows={stores} storeName={storeName} period={short} losing={losing} />}
            <CampaignsTable rows={camps} sort={sort} sortHref={(k) => link({ sort: k })} storeName={storeName} showStore={!single} period={short} />
            <DailyTable rows={days} range={rangeLabel} period={short} />
            <footer aria-label="How these are counted" className="max-w-[80ch] px-1 text-xs text-ink-3">
              Spend from Meta, orders from Shopify. A campaign&apos;s orders and ROAS count only orders carrying its campaign ID,
              so they read low by the untracked share; the store ROAS counts every order. Breakeven uses today&apos;s costs and
              the last 30 days&apos; delivery rates, on Meta&apos;s scale (incl. GST){pastMonth ? <>; a store&apos;s is weighted over {monthLabel(pastMonth)}&apos;s products by their ad spend</> : null}.
            </footer>
          </>
        )}
      </main>
    </>
  )
}
