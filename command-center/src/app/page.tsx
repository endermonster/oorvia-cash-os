import { Suspense } from 'react'
import { HomeView } from '@/components/Home'
import { StoreView } from '@/components/StoreView'
import { TopBar } from '@/components/TopBar'
import { Skeleton } from '@/components/Skeleton'
import { getData } from '@/lib/data'
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
  const d = await getData()
  const m = createMetrics(d)
  const view = readView(await searchParams, d.stores)
  const period = m.resolvePeriod(view.period)
  return (
    <>
      <TopBar tab="home" view={view} d={d} />
      {view.store === 'all'
        ? <HomeView view={view} period={period} m={m} />
        : <StoreView id={view.store} view={view} period={period} m={m} orders={d.orders} />}
    </>
  )
}
