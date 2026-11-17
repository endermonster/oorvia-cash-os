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

export function Signed({ value, className = '' }: { value: number; className?: string }) {
  const neg = value < 0
  return (
    <span className={`${neg ? 'text-bad' : ''} ${className}`}>
      {neg ? '−' : ''}₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(value)))}
    </span>
  )
}
