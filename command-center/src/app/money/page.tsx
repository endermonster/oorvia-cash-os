import { ArrowDown } from 'lucide-react'
import { Suspense } from 'react'
import { vfState } from '@/components/bits'
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
import { cachedBaselines, cachedCapital, cachedGst, cachedPnl } from '@/lib/cached'
import type { loadCapital } from '@/lib/gst-load'
import type { PnlResult } from '@/lib/pnl'

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
      attempt('pnl', () => cachedPnl(firstMonth, currentMonth, today)),
      attempt('gst', () => cachedGst(today)),
      attempt('capital', () => cachedCapital(today)),
      attempt('baselines', () => cachedBaselines()),
    ])
    if (!pnl) pnlError = 'The P&L could not be loaded. Try again; if it keeps failing, check the server log.'
  }
  const store = view.store === 'all' ? null : view.store
  const storeName = store ? (d.stores.find((s) => s.id === store)?.name ?? store) : 'All VXP'
  const vf = vfState(d.sync, (id) => d.stores.find((s) => s.id === id)?.name ?? id, 3)
  const storeFirst = store ? d.stores.find((s) => s.id === store)?.liveSince.slice(0, 7) || undefined : undefined
  const hasCapital = d.source === 'supabase' && capital !== null
  const forecast = pnl && baselines ? computeForecast(pnl, baselines, store, currentMonth, storeFirst) : null

  return (
    <>
      <TopBar tab="money" view={view} d={d} />
      <main className="mx-auto max-w-[1536px] space-y-3 px-3 pb-6 pt-3 sm:px-4">
        <h1 className="sr-only">Money</h1>
        {forecast ? (
          <a href="#forecast" className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink sm:hidden">Forecast <ArrowDown className="size-3.5" aria-hidden /></a>
        ) : null}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:grid-rows-[auto_1fr]">
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <CashCard c={m.cash()} store={store ? { id: store, name: storeName } : undefined} vf={vf} />
          </div>
          <div className={`min-w-0 lg:col-start-2 lg:row-start-1 ${hasCapital ? 'lg:row-span-2' : ''}`}>
            <GstCard g={gst} today={today} vf={vf} />
          </div>
          {hasCapital ? <div className="min-w-0 lg:col-start-1 lg:row-start-2"><CapitalCard c={capital} /></div> : null}
          <div className="min-w-0 lg:col-span-2">
            {pnl ? (
              <PnlTable pnl={pnl} store={store} storeName={storeName} currentMonth={currentMonth} />
            ) : (
              <section className="glass px-5 py-4">
                <h2 className="text-lg font-bold">Monthly P&amp;L</h2>
                <p className="mt-2 text-ink-2">{pnlError ?? 'The P&L reads real data only: set DATA_SOURCE=supabase.'}</p>
              </section>
            )}
          </div>
          {forecast ? <div className="min-w-0 lg:col-span-2"><ForecastCard f={forecast} scope={storeName} /></div> : null}
        </div>
      </main>
    </>
  )
}
