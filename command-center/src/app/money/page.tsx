import { Suspense } from 'react'
import { Later } from '@/components/Later'
import { Skeleton } from '@/components/Skeleton'

export default function Page({ searchParams }: PageProps<'/money'>) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Later tab="money" title="Money" searchParams={searchParams} items={['Cash: bank, Razorpay / PayU / Cashfree settlements due, vFulfill wallet, COD due', 'GST for the one GSTIN: output tax, input credit, GSTR-3B due date', 'Monthly P&L per store and for VXP', 'Your 50% share and what flows to the personal finance app']} />
    </Suspense>
  )
}
