'use client'

import { useMemo } from 'react'
import { inr } from '@/lib/metrics'
import { useTimeline } from './PerformanceTimeline'

const W = 300
const H = 56
const PAD = 3

function geometry(values: (number | null)[]) {
  const n = values.length
  const nums = values.filter((v): v is number => v !== null)
  const max = Math.max(0, ...nums)
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

  return { x, y, area, line }
}

export function Sparkline({ values, labels, kind, stroke, fill, dot, name }: {
  values: (number | null)[]; labels: string[]; kind: 'money' | 'count'
  stroke: string; fill: string; dot: string; name: string
}) {
  const { index, select, hintId } = useTimeline()
  const { x, y, area, line } = useMemo(() => geometry(values), [values])
  const n = values.length
  if (!n) return <p className="flex h-20 items-center text-xs text-ink-3">No timeline data</p>
  const hover = index !== null && index < n ? index : null
  const fmt = (v: number | null) => (v === null ? 'no orders' : kind === 'money' ? inr(v) : Math.round(v).toLocaleString('en-IN'))
  const hv = hover === null ? null : values[hover]

  const clampI = (i: number) => Math.max(0, Math.min(n - 1, i))
  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    select(clampI(Math.round(((e.clientX - r.left) / r.width) * (n - 1))))
  }
  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') { select(null); return }
    const at = hover ?? n - 1
    const step: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -7, PageUp: 7, Home: -n, End: n }
    if (!(e.key in step)) return
    e.preventDefault()
    select(clampI(at + step[e.key]))
  }
  const at = hover ?? n - 1

  return (
    <div role="slider" tabIndex={0} aria-describedby={hintId} aria-label={`${name}, ${labels[0]} to ${labels.at(-1)}`}
      aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={at} aria-valuetext={`${labels[at]}: ${fmt(values[at])}`}
      className="touch-pan-y cursor-crosshair select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-revenue/60 focus-visible:ring-offset-4 focus-visible:ring-offset-transparent"
      onPointerMove={onMove} onPointerDown={(e) => { e.currentTarget.focus({ preventScroll: true }); onMove(e) }}
      onPointerLeave={(e) => { if (e.pointerType !== 'touch' && !e.currentTarget.matches(':focus-visible')) select(null) }}
      onPointerCancel={() => select(null)} onKeyDown={onKey} onFocus={() => select(hover ?? n - 1)}>
      <div className="relative h-14">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block size-full overflow-visible" aria-hidden>
          <line x1={0} x2={W} y1={H} y2={H} className="stroke-line-strong" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
          <path d={area} className={fill} />
          <path d={line} style={{ fill: 'none' }} className={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} className="stroke-ink-2" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
        </svg>
        {hover !== null && hv !== null && (
          <span aria-hidden className={`pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-ground ${dot}`}
            style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(hv) / H) * 100}%` }} />
        )}
      </div>
      <div aria-hidden className="mt-2 flex items-baseline justify-between gap-1 text-xs tabular-nums text-ink-3">
        {hover === null
          ? <><span>{labels[0]}</span>{n > 1 && <span>{labels.at(-1)}</span>}</>
          : <><span className="text-ink-2">{labels[hover]}</span><strong className="text-right font-semibold text-ink">{fmt(hv)}</strong></>}
      </div>
    </div>
  )
}
