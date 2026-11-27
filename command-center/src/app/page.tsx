import { Suspense } from 'react'
import { HomeView } from '@/components/Home'
import { StoreView } from '@/components/StoreView'
import { TopBar } from '@/components/TopBar'
import { Skeleton } from '@/components/Skeleton'
import { getData, getHomeData } from '@/lib/data'
import { createMetrics, HOME_PERIODS, historyDaysFor } from '@/lib/metrics'
import { readView } from '@/lib/nav'
import { istNow } from '@/lib/dates'

export default function Page({ searchParams }: PageProps<'/'>) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  )
}

async function Dashboard({ searchParams }: { searchParams: PageProps<'/'>['searchParams'] }) {
  const params = await searchParams
  // The long ranges need more than the 70-day snapshot: read as many days as the period asked for needs
  // (a custom range validated first, so a short or unreadable one keeps the small read).
  const want = readView(params, [], HOME_PERIODS, true)
  const history = historyDaysFor(want.period, istNow(new Date()).today, want)
  // GST and the monthly P&L feed only the All VXP footer: a store view skips those reads.
  const d = typeof params.store === 'string' && params.store !== 'all' ? await getData(history) : await getHomeData(history)
  const m = createMetrics(d)
  const asked = readView(params, d.stores, HOME_PERIODS, true)
  const period = m.resolvePeriod(asked.period, asked)
  // The links carry what is showing: an unreadable custom range has fallen back to 7D, a valid one is clamped.
  const view = period.id === 'custom' ? { ...asked, from: period.from, to: period.to } : { store: asked.store, period: period.id }
  return (
    <>
      <TopBar tab="home" view={view} d={d} />
      {view.store === 'all'
        ? <HomeView view={view} period={period} m={m} now={d.now} mock={d.source === 'mock'} />
        : <StoreView id={view.store} view={view} period={period} m={m} orders={d.orders} />}
    </>
  )
}
