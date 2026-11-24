import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import type { StoreId, SyncStatus } from '@/lib/types'

export type RateSource = 'own-30d' | 'own-lifetime' | 'vxp' | 'sheet'

const STORE_BG: Record<StoreId, string> = {
  oorvia: 'bg-oorvia',
  kaiven: 'bg-kaiven',
  selnova: 'bg-selnova',
}

export function StoreDot({ id, size = 8 }: { id: StoreId; size?: number }) {
  return <span aria-hidden className={`inline-block shrink-0 rounded-full ${STORE_BG[id]}`} style={{ width: size, height: size }} />
}

/** Change vs previous period. `goodWhenUp` flips the colour for costs (CPM, spend). */
export function Delta({ now, prev, goodWhenUp = true, neutral = false, suffix }: { now: number; prev: number; goodWhenUp?: boolean; neutral?: boolean; suffix?: string }) {
  if (!prev) return null
  const change = now / prev - 1
  if (!Number.isFinite(change) || Math.abs(change) < 0.005) return <span className="text-sm text-ink-3">no change{suffix ? ` ${suffix}` : ''}</span>
  const up = change > 0
  const good = up === goodWhenUp
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-0.5 text-sm font-semibold ${neutral ? 'text-ink-2' : good ? 'text-good' : 'text-bad'}`}>
      <Icon className="size-4" aria-hidden />
      {up ? '+' : '−'}{Math.abs(change * 100).toFixed(0)}%
      {suffix && <span className="ml-1 font-normal text-ink-3">{suffix}</span>}
    </span>
  )
}

/** The two headline numbers: booked revenue (Shopify) and ad spend (Meta), each vs the previous period. */
export function Headline({ short, scope, prevLabel, revenue, prevRevenue, spend, prevSpend }: {
  short: string; scope: string; prevLabel: string; revenue: number; prevRevenue: number; spend: number; prevSpend: number
}) {
  const big = 'rise mt-3 text-[clamp(2.75rem,6vw,4.75rem)] font-extrabold leading-[0.95] tracking-[-0.04em] text-ink'
  return (
    <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
      <div>
        <p className="label">Revenue · {short} · {scope} · Shopify</p>
        <p className={big}><Signed value={revenue} /></p>
        <div className="mt-3"><Delta now={revenue} prev={prevRevenue} suffix={`vs ${prevLabel}`} /></div>
      </div>
      <div>
        <p className="label">Ad spend · {short} · {scope} · Meta</p>
        <p className={big}><Signed value={spend} /></p>
        <div className="mt-3"><Delta now={spend} prev={prevSpend} neutral suffix={`vs ${prevLabel}`} /></div>
      </div>
    </div>
  )
}

const RATE_SOURCE: Record<RateSource, string> = {
  'own-30d': 'last 30 days', 'own-lifetime': 'all-time', vxp: 'VXP average', sheet: 'pricing-sheet default',
}

/** Which delivery rates a profit estimate rests on, per store, in the same words on Home, the store view and Ads. */
export function rateSourceNote(sources: { store: { name: string }; source: RateSource }[]): string | null {
  if (sources.length === 0) return null
  if (sources.every((s) => s.source === 'own-30d')) {
    return sources.length === 1 ? `Delivery rates: ${sources[0].store.name}’s last 30 days` : 'Delivery rates: each store’s last 30 days'
  }
  return `Delivery rates: ${sources.map((s) => `${s.store.name} ${RATE_SOURCE[s.source]}`).join(' · ')}`
}

export type VfState = {
  stale: boolean
  /** Top bar chip, a few words. */
  short: string
  /** Follows "the shipments data …": "was last imported 4 days ago", "runs only to 2 Sept". */
  phrase: string
}

/**
 * vFulfill freshness, judged as Needs your call judges it: the worse of the import's age and the data's, except that
 * no order waiting on vFulfill and no shipment still open means current, however old the import. `staleAfter` in days.
 */
export function vfState(s: Pick<SyncStatus, 'vfulfillImportDaysAgo' | 'vfulfillDataDaysAgo' | 'shipmentsThrough' | 'vfulfillMissingStores' | 'vfulfillOverdueOrders' | 'vfulfillOpenShipments'>, names: (id: StoreId) => string, staleAfter: number): VfState {
  const imp = s.vfulfillImportDaysAgo
  const ago = (n: number) => (n === 0 ? 'today' : `${n} ${n === 1 ? 'day' : 'days'} ago`)
  if (imp === null) return { stale: true, short: 'never imported', phrase: 'has never been imported' }
  if (s.vfulfillMissingStores.length > 0) {
    const who = s.vfulfillMissingStores.map(names)
    return { stale: true, short: who.length === 1 ? `${who[0]} missing` : `${who.length} stores missing`, phrase: `left out ${who.join(' and ')} in its last import` }
  }
  // Current only when nothing is overdue and nothing still open could have closed since (Codex P1).
  if (s.vfulfillOverdueOrders === 0 && s.vfulfillOpenShipments === 0) return { stale: false, short: imp === 0 ? 'today' : 'up to date', phrase: `was last imported ${ago(imp)}, and nothing has been waiting to ship since` }
  const data = s.vfulfillDataDaysAgo
  if (data !== null && data > imp && data > staleAfter) {
    const through = s.shipmentsThrough ? fmtShort(s.shipmentsThrough) : null
    return { stale: true, short: `${data} days old`, phrase: through ? `runs only to ${through}` : `is ${data} days old` }
  }
  return imp > staleAfter
    ? { stale: true, short: `${imp} days old`, phrase: `was last imported ${ago(imp)}` }
    : { stale: false, short: imp === 0 ? 'today' : `${imp} ${imp === 1 ? 'day' : 'days'} old`, phrase: `was last imported ${ago(imp)}` }
}

const fmtShort = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Gain green, loss red, zero plain: ₹0 is not a gain. */
export const tone = (n: number) => (n > 0 ? 'text-good' : n < 0 ? 'text-bad' : 'text-ink-2')

export function Signed({ value, className = '' }: { value: number; className?: string }) {
  const neg = value < 0
  return (
    <span className={`${neg ? 'text-bad' : ''} ${className}`}>
      {neg ? '−' : ''}₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(value)))}
    </span>
  )
}
