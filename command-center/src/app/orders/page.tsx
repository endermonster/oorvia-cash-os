import { Suspense } from 'react'
import { Later } from '@/components/Later'
import { Skeleton } from '@/components/Skeleton'

export default function Page({ searchParams }: PageProps<'/orders'>) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Later tab="orders" title="Orders" searchParams={searchParams} items={['Every order across the three stores, newest first', 'Delivered, RTO and NDR, from the vFulfill imports', 'Delivery rate and RTO by store, payment type and state']} />
    </Suspense>
  )
}
