'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SeriesPoint } from '@/lib/metrics'

const inr = (n: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n))}`

function niceMax(v: number) {
  if (v <= 0) return 1000
  const p = 10 ** Math.floor(Math.log10(v))
  return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => v / p <= s)! * p
}

/** Plot height when the panel has no spare room (phones, short layouts); it grows to fill a taller panel. */
const MIN_H = 128
const WIDE = { l: 78, r: 108, t: 12, b: 30 }
/** Phones: short tick labels, no end-value tags (Home shows the values in the legend), so the plot gets the width. */
const NARROW = { l: 44, r: 14, t: 12, b: 30 }
const NARROW_BELOW = 480
const PAD = WIDE // t and b are shared by both

/** ₹60k, ₹1.2L: tick labels that fit a phone. */
const short = (n: number) => (n >= 1e5 ? `₹${+(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `₹${+(n / 1e3).toFixed(1)}k` : `₹${Math.round(n)}`)

/** Cumulative booked revenue against cumulative ad spend, one scale, labelled at the line ends. */
export function RevenueChart({ points, unit }: { points: SeriesPoint[]; unit: 'hour' | 'day' }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(900)
  const [H, setH] = useState(MIN_H)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      setW(Math.max(300, Math.round(e.contentRect.width)))
      setH(Math.max(MIN_H, Math.round(e.contentRect.height) - PAD.t - PAD.b))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const narrow = w < NARROW_BELOW
  const pad = narrow ? NARROW : WIDE

  const g = useMemo(() => {
    const pad = w < NARROW_BELOW ? NARROW : WIDE
    const n = points.length
    const plotW = w - pad.l - pad.r
    const x = (i: number) => pad.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
    const max = niceMax(Math.max(1, ...points.map((p) => Math.max(p.cumRevenue, p.cumSpend))))
    const y = (v: number) => PAD.t + H - (v / max) * H
    const path = (get: (p: SeriesPoint) => number) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(get(p)).toFixed(1)}`).join('')
    const rev = path((p) => p.cumRevenue)
    const area = `${rev}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`
    const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => f * max)
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 92))))
    return { n, x, y, rev, area, spend: path((p) => p.cumSpend), ticks, every }
  }, [points, w, H])

  if (points.length === 0) return <p className="py-10 text-center text-ink-3">No orders or ad spend yet in this period.</p>

  const last = points[points.length - 1]
  const lx = g.x(g.n - 1)
  const hv = hover === null ? null : points[hover]

  return (
    <div ref={wrap} className="relative min-h-[170px] flex-1">
      <svg width={w} height={PAD.t + H + PAD.b} role="img" className="absolute inset-x-0 top-0 block"
        aria-label={`Cumulative booked revenue ${inr(last.cumRevenue)} against ad spend ${inr(last.cumSpend)}`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const i = Math.round(((e.clientX - r.left - pad.l) / (w - pad.l - pad.r)) * (g.n - 1))
          setHover(i >= 0 && i < g.n ? i : null)
        }}
        onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="rev-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--color-revenue)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--color-revenue)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {g.ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={g.y(t)} y2={g.y(t)} stroke="var(--color-line)" />
            <text x={pad.l - 8} y={g.y(t)} dy="0.32em" textAnchor="end" className="fill-ink-3 text-[12px]">{narrow ? short(t) : inr(t)}</text>
          </g>
        ))}
        {/* The last date always shows; a regular tick too close before it is dropped so the two never bunch. */}
        {points.map((p, i) => ((i % g.every === 0 && g.n - 1 - i >= g.every) || i === g.n - 1) && (
          <text key={p.key} x={g.x(i)} y={PAD.t + H + 20} textAnchor={i === g.n - 1 && g.x(i) > w - 40 ? "end" : "middle"} className="fill-ink-3 text-[12px]">{p.label}</text>
        ))}
        <path d={g.area} fill="url(#rev-fill)" />
        <path d={g.spend} fill="none" stroke="var(--color-spend)" strokeWidth={2.25} strokeLinejoin="round" />
        <path d={g.rev} fill="none" stroke="var(--color-revenue)" strokeWidth={2.25} strokeLinejoin="round" />
        {unit === 'day' && points.map((p, i) => (
          <g key={p.key}>
            <circle cx={g.x(i)} cy={g.y(p.cumRevenue)} r={3} fill="var(--color-revenue)" />
            <circle cx={g.x(i)} cy={g.y(p.cumSpend)} r={3} fill="var(--color-spend)" />
          </g>
        ))}
        <circle cx={lx} cy={g.y(last.cumRevenue)} r={5} fill="#0a1222" stroke="var(--color-revenue)" strokeWidth={2.5} />
        <circle cx={lx} cy={g.y(last.cumSpend)} r={5} fill="#0a1222" stroke="var(--color-spend)" strokeWidth={2.5} />
        {hv && hover !== null && <line x1={g.x(hover)} x2={g.x(hover)} y1={PAD.t} y2={PAD.t + H} stroke="var(--color-ink-3)" strokeDasharray="3 3" />}
      </svg>
      {!narrow && <>
        <EndLabel x={lx + 12} y={g.y(last.cumRevenue)} tone="revenue" text={inr(last.cumRevenue)} other={g.y(last.cumSpend)} />
        <EndLabel x={lx + 12} y={g.y(last.cumSpend)} tone="spend" text={inr(last.cumSpend)} other={g.y(last.cumRevenue)} />
      </>}
      {hv && hover !== null && (
        <div className="glass-pill pointer-events-none absolute top-0 bg-[rgb(10_16_30/0.85)] px-3 py-2 text-xs backdrop-blur-md"
          style={{ left: Math.min(g.x(hover) + 10, w - 190) }}>
          <p className="font-semibold text-ink">{hv.label} · so far</p>
          <p className="mt-1 text-revenue">Revenue {inr(hv.cumRevenue)}</p>
          <p className="text-spend">Spend {inr(hv.cumSpend)}</p>
        </div>
      )}
    </div>
  )
}

/** Value tag at a line's end; nudged apart when the two ends crowd each other. */
function EndLabel({ x, y, tone, text, other }: { x: number; y: number; tone: 'revenue' | 'spend'; text: string; other: number }) {
  const gap = 26
  const dy = Math.abs(y - other) < gap ? (y < other ? -(gap - Math.abs(y - other)) / 2 : (gap - Math.abs(y - other)) / 2) : 0
  const c = tone === 'revenue' ? 'text-revenue ring-revenue/50 bg-revenue/10' : 'text-spend ring-spend/50 bg-spend/10'
  return (
    <span className={`absolute -translate-y-1/2 rounded-md px-1.5 py-0.5 text-[13px] font-semibold ring-1 ${c}`} style={{ left: x, top: y + dy }}>
      {text}
    </span>
  )
}
