'use client'

import { useState } from 'react'
import { inr } from '@/lib/metrics'

const W = 300
const H = 56
const PAD = 3

/**
 * One series per bucket, drawn edge to edge under a stat card. Stretches to the card's width (the stroke keeps its
 * 2px); a null value is a gap (AOV on a day without orders). Hover shows the bucket and its value.
 * Keyboard: a slider over the buckets. Focus lands on the newest; arrows step one, Page Up/Down a week, Home/End jump.
 * Screen readers hear each bucket's label and value as its value text.
 */
export function Sparkline({ values, labels, kind, stroke, fill, dot, name }: {
  values: (number | null)[]; labels: string[]; kind: 'money' | 'count'
  /** Tailwind classes for the line, the area under it, and the hover dot. */
  stroke: string; fill: string; dot: string
  name: string
}) {
  const [picked, setHover] = useState<number | null>(null)
  const n = values.length
  // Kept in range: after Back to a shorter period the card stays mounted and the old index can outrun the new series.
  const hover = picked === null ? null : Math.max(0, Math.min(n - 1, picked))
  const nums = values.filter((v): v is number => v !== null)
  if (n === 0 || nums.length === 0) return <div className="h-11" aria-hidden />
  const max = Math.max(...nums)
  const min = Math.min(0, ...nums)
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W)
  const y = (v: number) => PAD + (H - 2 * PAD) * (1 - (max === min ? 0.5 : (v - min) / (max - min)))

  // Runs of consecutive values: a gap breaks the line and the area.
  const runs: number[][] = []
  values.forEach((v, i) => {
    if (v === null) return
    const last = runs.at(-1)
    if (last && last.at(-1) === i - 1) last.push(i)
    else runs.push([i])
  })
  // A lone value (AOV on a day between days without orders) is a dot: a zero-length stroke with round caps.
  const line = runs.map((r) => r.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(values[i]!).toFixed(1)}`).join('') + (r.length === 1 ? 'l0.01,0' : '')).join('')
  const area = runs.filter((r) => r.length > 1).map((r) =>
    `${r.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(values[i]!).toFixed(1)}`).join('')}L${x(r.at(-1)!).toFixed(1)},${H}L${x(r[0]).toFixed(1)},${H}Z`).join('')

  const fmt = (v: number | null) => (v === null ? 'no orders' : kind === 'money' ? inr(v) : Math.round(v).toLocaleString('en-IN'))
  const hv = hover === null ? null : values[hover]

  const clampI = (i: number) => Math.max(0, Math.min(n - 1, i))
  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    setHover(clampI(Math.round(((e.clientX - r.left) / r.width) * (n - 1))))
  }
  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const at = hover ?? n - 1
    const step: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -7, PageUp: 7, Home: -n, End: n }
    if (!(e.key in step)) return
    e.preventDefault()
    setHover(clampI(at + step[e.key]))
  }
  const at = hover ?? n - 1

  return (
    <div role="slider" tabIndex={0} aria-label={`${name}, ${labels[0]} to ${labels.at(-1)}`}
      aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={at} aria-valuetext={`${labels[at]}: ${fmt(values[at])}`}
      className="relative h-11 touch-pan-y rounded-md outline-none focus-visible:ring-2 focus-visible:ring-revenue/60 focus-visible:ring-offset-4 focus-visible:ring-offset-transparent"
      onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={(e) => { if (document.activeElement !== e.currentTarget) setHover(null) }}
      onKeyDown={onKey} onFocus={() => setHover((h) => h ?? n - 1)} onBlur={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block size-full overflow-visible" aria-hidden>
        <path d={area} className={fill} />
        <path d={line} style={{ fill: 'none' }} className={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} className="stroke-ink-3" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      {hover !== null && (
        <>
          {hv !== null && (
            <span aria-hidden className={`pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-ground ${dot}`}
              style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(hv) / H) * 100}%` }} />
          )}
          <span aria-hidden className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border border-line-strong bg-raised-2/95 px-2 py-1 text-xs tabular-nums text-ink-2"
            style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover / Math.max(1, n - 1) > 0.5 ? '-100%' : '0'})` }}>
            {labels[hover]} · <span className="font-semibold text-ink">{fmt(hv)}</span>
          </span>
        </>
      )}
    </div>
  )
}
