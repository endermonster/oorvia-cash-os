'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SeriesPoint } from '@/lib/metrics'
import { useHighlight } from './LinkedHighlight'

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

/** A store's running totals on VXP's buckets: a bucket the store has no point for carries its last value forward. */
function alignTo(points: SeriesPoint[], own: SeriesPoint[]) {
  const byKey = new Map(own.map((p) => [p.key, p]))
  let rev = 0, sp = 0
  return points.map((p) => {
    const o = byKey.get(p.key)
    if (o) { rev = o.cumRevenue; sp = o.cumSpend }
    return { cumRevenue: rev, cumSpend: sp }
  })
}

/**
 * Cumulative booked revenue against cumulative ad spend, one scale, labelled at the line ends. While a store is traced
 * (linked highlight) VXP's lines go grey and the store's own revenue band and spend line are drawn over them.
 */
export function RevenueChart({ points, unit, byStore }: { points: SeriesPoint[]; unit: 'hour' | 'day'; byStore?: { id: string; name: string; points: SeriesPoint[] }[] }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(900)
  const [H, setH] = useState(MIN_H)
  const [hover, setHover] = useState<number | null>(null)
  const hl = useHighlight()
  const hasPoints = points.length > 0

  useEffect(() => {
    if (!hasPoints) return
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      setW(Math.max(300, Math.round(e.contentRect.width)))
      setH(Math.max(MIN_H, Math.round(e.contentRect.height) - PAD.t - PAD.b))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasPoints])

  const narrow = w < NARROW_BELOW
  const pad = narrow ? NARROW : WIDE
  const traced = hl ? byStore?.find((s) => s.id === hl) ?? null : null
  const own = useMemo(() => (traced ? alignTo(points, traced.points) : null), [traced, points])

  const g = useMemo(() => {
    const pad = w < NARROW_BELOW ? NARROW : WIDE
    const n = points.length
    const plotW = w - pad.l - pad.r
    const x = (i: number) => pad.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
    const max = niceMax(Math.max(1, ...points.map((p) => Math.max(p.cumRevenue, p.cumSpend))))
    const y = (v: number) => PAD.t + H - (v / max) * H
    const path = <T,>(list: T[], get: (p: T) => number) => list.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(get(p)).toFixed(1)}`).join('')
    const area = (line: string) => `${line}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`
    const rev = path(points, (p) => p.cumRevenue)
    const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => f * max)
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 92))))
    const ownRev = own ? path(own, (p) => p.cumRevenue) : null
    return { n, x, y, rev, area: area(rev), spend: path(points, (p) => p.cumSpend), ticks, every,
      ownRev, ownArea: ownRev ? area(ownRev) : null, ownSpend: own ? path(own, (p) => p.cumSpend) : null }
  }, [points, w, H, own])

  if (points.length === 0) return <p className="py-10 text-center text-ink-3">No orders or ad spend yet in this period.</p>

  const last = points[points.length - 1]
  const end = own ? own[own.length - 1] : last
  const lx = g.x(g.n - 1)
  const hv = hover === null ? null : points[hover]
  const grey = 'var(--color-line-strong)'

  return (
    <div ref={wrap} className="relative min-h-[170px] flex-1">
      <svg width={w} height={PAD.t + H + PAD.b} role="img" className="absolute inset-x-0 top-0 block"
        aria-label={`Cumulative booked revenue ${inr(last.cumRevenue)} against ad spend ${inr(last.cumSpend)}${traced ? `; ${traced.name} ${inr(end.cumRevenue)} against ${inr(end.cumSpend)}` : ''}`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const i = Math.round(((e.clientX - r.left - pad.l) / (w - pad.l - pad.r)) * (g.n - 1))
          setHover(i >= 0 && i < g.n ? i : null)
        }}
        onPointerLeave={() => setHover(null)}>
        {g.ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={g.y(t)} y2={g.y(t)} stroke="var(--color-line-strong)" strokeDasharray="2 4" />
            <text x={pad.l - 8} y={g.y(t)} dy="0.32em" textAnchor="end" className="fill-ink-4 text-[12px]">{narrow ? short(t) : inr(t)}</text>
          </g>
        ))}
        {/* The last date always shows; a regular tick too close before it is dropped so the two never bunch. */}
        {points.map((p, i) => ((i % g.every === 0 && g.n - 1 - i >= g.every) || i === g.n - 1) && (
          <text key={p.key} x={g.x(i)} y={PAD.t + H + 20} textAnchor={i === g.n - 1 && g.x(i) > w - 40 ? "end" : "middle"}
            className={i === g.n - 1 ? 'fill-ink text-[12px] font-semibold' : 'fill-ink-4 text-[12px]'}>{p.label}</text>
        ))}
        {!traced && <path d={g.area} fill="var(--color-lime)" fillOpacity={0.07} />}
        <path d={g.spend} fill="none" stroke={traced ? grey : 'var(--color-spend)'} strokeOpacity={traced ? 1 : 0.8} strokeWidth={1.75} strokeDasharray="5 5" strokeLinejoin="round" className="transition-[stroke] duration-300" />
        <path d={g.rev} fill="none" stroke={traced ? grey : 'var(--color-revenue)'} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" className="transition-[stroke] duration-300" />
        {g.ownArea && <path d={g.ownArea} fill="var(--color-lime)" fillOpacity={0.16} />}
        {g.ownSpend && <path d={g.ownSpend} fill="none" stroke="var(--color-lime)" strokeWidth={1.75} strokeDasharray="5 5" strokeLinejoin="round" />}
        {g.ownRev && <path d={g.ownRev} fill="none" stroke="var(--color-lime)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
        {unit === 'hour' && !traced && points.map((p, i) => <circle key={p.key} cx={g.x(i)} cy={g.y(p.cumRevenue)} r={2.5} fill="var(--color-revenue)" />)}
        <circle cx={lx} cy={g.y(end.cumRevenue)} r={4.5} fill="var(--color-raised)" stroke="var(--color-lime)" strokeWidth={2.5} />
        <circle cx={lx} cy={g.y(end.cumSpend)} r={4.5} fill="var(--color-raised)" stroke={traced ? 'var(--color-lime)' : 'var(--color-spend)'} strokeWidth={2.5} />
        {hv && hover !== null && <line x1={g.x(hover)} x2={g.x(hover)} y1={PAD.t} y2={PAD.t + H} stroke="var(--color-ink-3)" strokeDasharray="3 3" />}
      </svg>
      {!narrow && <>
        <EndLabel x={lx + 12} y={g.y(end.cumRevenue)} tone="revenue" text={inr(end.cumRevenue)} other={g.y(end.cumSpend)} />
        <EndLabel x={lx + 12} y={g.y(end.cumSpend)} tone="spend" text={inr(end.cumSpend)} other={g.y(end.cumRevenue)} />
      </>}
      {hv && hover !== null && (
        <div className="pointer-events-none absolute top-0 rounded-lg border border-line-strong bg-raised-2 px-3 py-2 text-xs"
          style={{ left: Math.min(g.x(hover) + 10, w - 190) }}>
          <p className="font-semibold text-ink">{hv.label} · so far</p>
          <p className="mt-1 text-lime">Revenue {inr(hv.cumRevenue)}</p>
          <p className="text-ink-2">Spend {inr(hv.cumSpend)}</p>
          {own && traced && <p className="mt-1 border-t border-line-strong pt-1 text-lime">{traced.name} {inr(own[hover].cumRevenue)} · spend {inr(own[hover].cumSpend)}</p>}
        </div>
      )}
    </div>
  )
}

/** Value tag at a line's end; nudged apart when the two ends crowd each other. */
function EndLabel({ x, y, tone, text, other }: { x: number; y: number; tone: 'revenue' | 'spend'; text: string; other: number }) {
  const gap = 26
  const dy = Math.abs(y - other) < gap ? (y < other ? -(gap - Math.abs(y - other)) / 2 : (gap - Math.abs(y - other)) / 2) : 0
  const c = tone === 'revenue' ? 'bg-lime text-on-lime' : 'bg-raised-2 text-ink'
  return (
    <span className={`absolute -translate-y-1/2 rounded-md px-2 py-0.5 text-[13px] font-bold transition-[top] duration-500 ease-out ${c}`} style={{ left: x, top: y + dy }}>
      {text}
    </span>
  )
}
