'use client'

import { useState } from 'react'
import { inr } from '@/lib/metrics'

/** More buckets than this are merged (a year of days becomes ~30 columns of about 12 days), so a column stays a column. */
const MAX_COLS = 30

/**
 * One series as columns of stacked squares, under a stat cell. A null is an empty column (AOV on a day without
 * orders). `merge`: how merged buckets combine; sum for revenue, orders and spend; ratio for an average such as AOV, where `values` are the numerators (revenue) and `den` the
 * denominators (orders): a merged column is its total revenue over its total orders, never a mean of daily averages.
 * Hover shows the bucket and its value. Keyboard: a slider over the columns, like the sparkline it replaced.
 */
export function SquareBars({ values, den, labels, kind, name, merge = 'sum', lit = false }: {
  values: (number | null)[]; labels: string[]; kind: 'money' | 'count'; name: string
  merge?: 'sum' | 'ratio'
  /** With merge 'ratio': the denominator per bucket, same length as `values`. */
  den?: number[]
  /** Lime squares (revenue, or a traced store); otherwise ink. */
  lit?: boolean
}) {
  const [picked, setPicked] = useState<number | null>(null)
  const size = Math.max(1, Math.ceil(values.length / MAX_COLS))
  const cols: { v: number | null; label: string }[] = []
  for (let i = 0; i < values.length; i += size) {
    const chunk = values.slice(i, i + size)
    let v: number | null
    if (merge === 'ratio') {
      const d = (den ?? []).slice(i, i + size).reduce((a, b) => a + b, 0)
      v = d > 0 ? chunk.reduce<number>((a, b) => a + (b ?? 0), 0) / d : null
    } else {
      const nums = chunk.filter((x): x is number => x !== null)
      v = nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0)
    }
    const l = size === 1 ? labels[i] : `${labels[i]}–${labels[Math.min(i + size, values.length) - 1]}`
    cols.push({ v, label: l })
  }
  const n = cols.length
  const max = Math.max(0, ...cols.map((c) => c.v ?? 0))
  if (n === 0 || max === 0) return <div className="h-11 w-2/5 max-w-40 shrink-0" aria-hidden />
  const hover = picked === null ? null : Math.max(0, Math.min(n - 1, picked))
  const at = hover ?? n - 1
  const fmt = (v: number | null) => (v === null ? 'no orders' : kind === 'money' ? inr(v) : Math.round(v).toLocaleString('en-IN'))
  const gap = n <= 10 ? 4 : n <= 20 ? 2 : 1
  const squares = `repeating-linear-gradient(0deg, currentColor 0 5px, transparent 5px 7px)`

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    setPicked(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n))))
  }
  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, Home: -n, End: n }
    if (!(e.key in step)) return
    e.preventDefault()
    setPicked(Math.max(0, Math.min(n - 1, at + step[e.key])))
  }

  return (
    <div role="slider" tabIndex={0} aria-label={`${name}, ${cols[0].label} to ${cols[n - 1].label}`}
      aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={at} aria-valuetext={`${cols[at].label}: ${fmt(cols[at].v)}`}
      className={`relative flex h-11 min-w-[4.5rem] w-2/5 max-w-40 shrink-0 max-sm:w-full max-sm:max-w-none touch-pan-y items-end rounded-sm ${lit ? 'text-lime' : 'text-ink-2'}`}
      style={{ gap }}
      onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={(e) => { if (document.activeElement !== e.currentTarget) setPicked(null) }}
      onKeyDown={onKey} onFocus={() => setPicked((h) => h ?? n - 1)} onBlur={() => setPicked(null)}>
      {cols.map((c, i) => (
        <span key={i} aria-hidden className="relative h-full flex-1"
          style={{ background: `repeating-linear-gradient(0deg, var(--color-raised-2) 0 5px, transparent 5px 7px)`, opacity: hover !== null && hover !== i ? 0.55 : 1 }}>
          {c.v !== null && c.v > 0 && <i className="absolute inset-x-0 bottom-0" style={{ height: `${Math.max(12, (c.v / max) * 100)}%`, background: squares }} />}
        </span>
      ))}
      {hover !== null && (
        <span aria-hidden className="pointer-events-none absolute bottom-full z-10 mb-1.5 whitespace-nowrap rounded-md border border-line-strong bg-raised-2 px-2 py-1 text-xs tabular-nums text-ink-2"
          style={{ left: `${((hover + 0.5) / n) * 100}%`, transform: `translateX(${hover / Math.max(1, n - 1) > 0.5 ? '-100%' : '0'})` }}>
          {cols[hover].label} · <span className="font-semibold text-ink">{fmt(cols[hover].v)}</span>
        </span>
      )}
    </div>
  )
}
