import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import type { StoreId } from '@/lib/types'

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
