import Link from 'next/link'
import { Suspense } from 'react'
import { AdsStatsRow, CampaignsTable, DailyTable, StoreAdsTable } from '@/components/AdsParts'
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

  return (
    <>
      <TopBar tab="ads" view={{ ...view, keep: { path: '/ads', params: keep } }} d={d} />
      <main className="mx-auto max-w-[1440px] px-4 py-10 sm:px-8 lg:px-10">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">Ads <span className="text-xl font-semibold text-ink-2">· {rangeLabel}</span></h1>
          <nav aria-label="Month" className="flex items-center gap-3 text-sm">
            <Link href={link({ period: 'month', month: prevMonth })} className="rounded-md px-2 py-1 text-ink-2 hover:text-ink">‹ {monthLabel(prevMonth)}</Link>
            {view.period === 'month' ? <span className="font-semibold text-ink">{monthLabel(shown)}</span> : null}
            {nextMonth
              ? <Link href={link({ period: 'month', month: nextMonth })} className="rounded-md px-2 py-1 text-ink-2 hover:text-ink">{monthLabel(nextMonth)} ›</Link>
              : null}
          </nav>
        </div>

        {d.source !== 'supabase' ? (
          <p className="mt-8 rounded-xl bg-raised p-6 text-ink-2">Ads reads real data only: set DATA_SOURCE=supabase.</p>
        ) : error || !data ? (
          <p className="mt-8 rounded-xl bg-raised p-6 text-ink-2">{error}</p>
        ) : (
          <>
            <p className="mt-2 max-w-[80ch] text-sm text-ink-3">
              Spend from Meta, orders from Shopify. A campaign&apos;s orders and ROAS count only orders carrying its campaign ID,
              so they read low by the untracked share; the store ROAS counts every order. Breakeven uses today&apos;s costs and
              the last 30 days&apos; delivery rates, on Meta&apos;s scale (incl. GST){pastMonth ? <>; a store&apos;s is weighted over {monthLabel(pastMonth)}&apos;s products by their ad spend</> : null}.
              {notConnected.length > 0 ? <span className="text-warn"> Meta not connected yet: {notConnected.join(', ')}.</span> : null}
            </p>
            <div className="mt-6"><AdsStatsRow t={total} be={single ? stores[0]?.be ?? null : null} single={single} /></div>

            {!single ? <div className="mt-8"><StoreAdsTable rows={stores} storeName={storeName} /></div> : null}

            <h2 className="mt-10 text-base font-semibold text-ink">Campaigns <span className="font-normal text-ink-3">· {camps.length}</span></h2>
            <div className="mt-3">
              <CampaignsTable rows={camps} sort={sort} sortHref={(k) => link({ sort: k })} storeName={storeName} showStore={!single} />
            </div>

            <h2 className="mt-10 text-base font-semibold text-ink">Daily</h2>
            <div className="mt-3"><DailyTable rows={days} /></div>
          </>
        )}
      </main>
    </>
  )
}
