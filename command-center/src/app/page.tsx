import { Suspense } from 'react'
import { HomeView } from '@/components/Home'
import { StoreView } from '@/components/StoreView'
import { TopBar } from '@/components/TopBar'
import { Skeleton } from '@/components/Skeleton'
import { resolvePeriod } from '@/lib/metrics'
import { readView } from '@/lib/nav'

export default function Page({ searchParams }: PageProps<'/'>) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  )
}

async function Dashboard({ searchParams }: { searchParams: PageProps<'/'>['searchParams'] }) {
  const view = readView(await searchParams)
  const period = resolvePeriod(view.period)
  return (
    <>
      <TopBar tab="home" view={view} />
      {view.store === 'all' ? <HomeView view={view} period={period} /> : <StoreView id={view.store} view={view} period={period} />}
    </>
  )
}
