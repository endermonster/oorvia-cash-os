import { Suspense } from 'react'
import { Later } from '@/components/Later'
import { Skeleton } from '@/components/Skeleton'

export default function Page({ searchParams }: PageProps<'/ads'>) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Later tab="ads" title="Ads" searchParams={searchParams} items={['Every campaign across the Kaiven, Selnova and Oorvia ad accounts, sortable by spend, CPA and ROAS', 'Each campaign against its store’s breakeven and target', 'Ad sets and ads one level down', 'A link straight to the ad set in Ads Manager']} />
    </Suspense>
  )
}
