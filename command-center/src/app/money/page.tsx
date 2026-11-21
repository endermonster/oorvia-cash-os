import { Settings } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'
import { CashCard } from '@/components/CashCard'
import { CapitalCard, ForecastCard, GstCard } from '@/components/MoneyParts'
import { PnlTable } from '@/components/PnlTable'
import { Skeleton } from '@/components/Skeleton'
import { TopBar } from '@/components/TopBar'
import { getData } from '@/lib/data'
import { istNow } from '@/lib/dates'
import { createMetrics } from '@/lib/metrics'
import { readView } from '@/lib/nav'
import { computeForecast, type Baseline } from '@/lib/forecast'
import type { GstResult } from '@/lib/gst'
import { loadCapital, loadGst } from '@/lib/gst-load'
import type { PnlResult } from '@/lib/pnl'
import { loadBaselines, loadPnl } from '@/lib/pnl-load'

export default function Page({ searchParams }: PageProps<'/money'>) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Money searchParams={searchParams} />
    </Suspense>
  )
}

/** A failed part shows its own message; the rest of the page still renders. */
async function attempt<T>(what: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run()
  } catch (e) {
    console.error(`money ${what}: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

async function Money({ searchParams }: { searchParams: PageProps<'/money'>['searchParams'] }) {
  const d = await getData()
  const m = createMetrics(d)
  const view = readView(await searchParams, d.stores)
  const today = istNow(d.now).today
  const currentMonth = today.slice(0, 7)
  const firstMonth = d.stores.map((s) => s.liveSince.slice(0, 7)).filter(Boolean).sort()[0] ?? currentMonth

  let pnl: PnlResult | null = null
  let pnlError: string | null = null
  let gst: GstResult | null = null
  let capital: Awaited<ReturnType<typeof loadCapital>> | null = null
  let baselines: Baseline[] | null = null
  if (d.source === 'supabase') {
    ;[pnl, gst, capital, baselines] = await Promise.all([
      attempt('pnl', () => loadPnl(firstMonth, currentMonth, today)),
      attempt('gst', () => loadGst(today)),
      attempt('capital', () => loadCapital(today)),
      attempt('baselines', () => loadBaselines()),
    ])
    if (!pnl) pnlError = 'The P&L could not be loaded. Try again; if it keeps failing, check the server log.'
  }
  const store = view.store === 'all' ? null : view.store
  const storeName = store ? (d.stores.find((s) => s.id === store)?.name ?? store) : 'All VXP'
  const storeFirst = store ? d.stores.find((s) => s.id === store)?.liveSince.slice(0, 7) || undefined : undefined
  const forecast = pnl && baselines ? computeForecast(pnl, baselines, store, currentMonth, storeFirst) : null

  return (
    <>
      <TopBar tab="money" view={view} d={d} />
      <main className="mx-auto max-w-[1440px] px-4 py-10 sm:px-8 lg:px-10">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="text-3xl font-extrabold tracking-tight text-ink">Money</h1>
          {/* Until the top bar has its gear icon. */}
          <Link href="/settings" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink"><Settings className="size-4" aria-hidden />Settings: bank, vFulfill, costs, GST, loans</Link>
        </div>
        <div className="mt-8 grid gap-10 lg:grid-cols-12">
          <div className="space-y-10 lg:col-span-6">
            <CashCard c={m.cash()} store={store ? { id: store, name: storeName } : undefined} />
            {d.source === 'supabase' ? <CapitalCard c={capital} /> : null}
          </div>
          <div className="lg:col-span-6"><GstCard g={gst} today={today} vfDaysAgo={d.sync.vfulfillImportDaysAgo} /></div>
          <div className="lg:col-span-12">
            {pnl ? (
              <PnlTable pnl={pnl} store={store} storeName={storeName} currentMonth={currentMonth} />
            ) : (
              <section className="rounded-xl bg-raised p-6">
                <h2 className="text-base font-semibold text-ink">Monthly P&amp;L</h2>
                <p className="mt-2 text-ink-2">{pnlError ?? 'The P&L reads real data only: set DATA_SOURCE=supabase.'}</p>
              </section>
            )}
          </div>
          {forecast ? <div className="lg:col-span-12"><ForecastCard f={forecast} scope={storeName} /></div> : null}
        </div>
      </main>
    </>
  )
}
