import { Suspense } from 'react'
import { CashCard } from '@/components/CashCard'
import { Skeleton } from '@/components/Skeleton'
import { TopBar } from '@/components/TopBar'
import { getData } from '@/lib/data'
import { createMetrics } from '@/lib/metrics'
import { readView } from '@/lib/nav'

export default function Page({ searchParams }: PageProps<'/money'>) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Money searchParams={searchParams} />
    </Suspense>
  )
}

const LATER = ['GST for the one GSTIN: output tax, input credit, GSTR-3B due date', 'Monthly P&L per store and for VXP', 'Your 50% share and what flows to the personal finance app']

async function Money({ searchParams }: { searchParams: PageProps<'/money'>['searchParams'] }) {
  const d = await getData()
  const m = createMetrics(d)
  const view = readView(await searchParams, d.stores)
  return (
    <>
      <TopBar tab="money" view={view} d={d} />
      <main className="mx-auto max-w-[1440px] px-4 py-10 sm:px-8 lg:px-10">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">Money</h1>
        <div className="mt-8 grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-6"><CashCard c={m.cash()} /></div>
          <div className="lg:col-span-6">
            <h2 className="text-base font-semibold text-ink">Coming next</h2>
            <ul className="mt-3 max-w-[60ch] list-disc space-y-2 pl-5 text-ink-2 marker:text-ink-3">
              {LATER.map((i) => <li key={i}>{i}</li>)}
            </ul>
          </div>
        </div>
      </main>
    </>
  )
}
