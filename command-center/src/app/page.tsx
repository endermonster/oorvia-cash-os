import { Suspense } from 'react'
import { HomeView } from '@/components/Home'
import { StoreView } from '@/components/StoreView'
import { TopBar } from '@/components/TopBar'
import { Skeleton } from '@/components/Skeleton'
import { getData, getHomeData } from '@/lib/data'
import { createMetrics } from '@/lib/metrics'
import { readView } from '@/lib/nav'

export default function Page({ searchParams }: PageProps<'/'>) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  )
}

async function Dashboard({ searchParams }: { searchParams: PageProps<'/'>['searchParams'] }) {
  const params = await searchParams
  // GST and the monthly P&L feed only the All VXP footer: a store view skips those reads.
  const d = typeof params.store === 'string' && params.store !== 'all' ? await getData() : await getHomeData()
  const m = createMetrics(d)
  const view = readView(params, d.stores)
  const period = m.resolvePeriod(view.period)
  return (
    <>
      <TopBar tab="home" view={view} d={d} />
      {view.store === 'all'
        ? <HomeView view={view} period={period} m={m} now={d.now} mock={d.source === 'mock'} />
        : <StoreView id={view.store} view={view} period={period} m={m} orders={d.orders} />}
    </>
  )
}
