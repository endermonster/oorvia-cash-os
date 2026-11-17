'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SeriesPoint } from '@/lib/metrics'

const inr = (n: number) => `${n < 0 ? '−' : ''}₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.abs(Math.round(n)))}`
const short = (n: number) => {
  const a = Math.abs(n)
  const s = a >= 1e5 ? `${(a / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L` : a >= 1000 ? `${Math.round(a / 1000)}k` : `${Math.round(a)}`
  return `${n < 0 ? '−' : ''}₹${s}`
}

function niceMax(v: number) {
  if (v <= 0) return 1000
  const p = 10 ** Math.floor(Math.log10(v))
  const m = v / p
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
  return steps.find((s) => m <= s)! * p
}

const TOP_H = 230
const BOT_H = 120
const GAP = 46
const PAD = { l: 52, r: 76, t: 10, b: 26 }

export function PaceChart({ points, title, prevLabel, unit }: { points: SeriesPoint[]; title: string; prevLabel: string; unit: 'hour' | 'day' }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(760)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const g = useMemo(() => {
    const n = points.length
    const plotW = w - PAD.l - PAD.r
    const x = (i: number) => PAD.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)

    const topMax = niceMax(Math.max(...points.map((p) => Math.max(p.cumRevenue, p.cumSpend, p.prevCumRevenue ?? 0))))
    const yTop = (v: number) => PAD.t + TOP_H - (v / topMax) * TOP_H

    const pMax = Math.max(0, ...points.map((p) => p.cumProfit))
    const pMin = Math.min(0, ...points.map((p) => p.cumProfit))
    const span = niceMax(Math.max(pMax - pMin, 1))
    const lo = pMin < 0 ? -niceMax(-pMin) : 0
    const hi = Math.max(lo + span, niceMax(pMax))
    const botTop = PAD.t + TOP_H + GAP
    const yBot = (v: number) => botTop + BOT_H - ((v - lo) / (hi - lo)) * BOT_H

    const line = (get: (p: SeriesPoint) => number | null, y: (v: number) => number) =>
      points.map((p, i) => { const v = get(p); return v === null ? '' : `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}` }).join('')

    const zeroY = yBot(0)
    const profitPath = line((p) => p.cumProfit, yBot)
    const profitArea = `${profitPath}L${x(n - 1).toFixed(1)},${zeroY}L${x(0).toFixed(1)},${zeroY}Z`

    const ticks = [0, topMax / 2, topMax]
    const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 90))))
    return { n, x, yTop, yBot, topMax, ticks, lo, hi, zeroY, botTop, profitPath, profitArea, labelEvery, plotW,
      rev: line((p) => p.cumRevenue, yTop), spend: line((p) => p.cumSpend, yTop), prev: line((p) => p.prevCumRevenue, yTop) }
  }, [points, w])

  const H = PAD.t + TOP_H + GAP + BOT_H + PAD.b
  const last = points[points.length - 1]
  const hp = hover === null ? null : points[hover]

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const fx = (e.clientX - r.left) / r.width
    setHover(Math.max(0, Math.min(g.n - 1, Math.round(fx * (g.n - 1)))))
  }

  return (
    <figure className="m-0">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-2" aria-label="Legend">
          <li className="flex items-center gap-2"><span className="h-0.5 w-4 rounded bg-revenue" />Booked revenue</li>
          <li className="flex items-center gap-2"><span className="h-0.5 w-4 rounded bg-spend" />Ad spend</li>
          <li className="flex items-center gap-2"><span className="w-4 border-t-2 border-dashed border-ink-3" />Revenue, {prevLabel}</li>
        </ul>
      </figcaption>

      <div ref={wrap} className="relative mt-4">
        <svg width={w} height={H} role="img" aria-label={`${title}: booked revenue ${inr(last.cumRevenue)}, ad spend ${inr(last.cumSpend)}, profit estimate ${inr(last.cumProfit)}`} className="block select-none">
          {/* top panel grid */}
          {g.ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={w - PAD.r} y1={g.yTop(t)} y2={g.yTop(t)} className="stroke-line" />
              <text x={PAD.l - 10} y={g.yTop(t)} dy="0.35em" textAnchor="end" className="fill-ink-3 text-[11px]">{short(t)}</text>
            </g>
          ))}
          <path d={g.prev} fill="none" className="stroke-ink-3" strokeWidth={1.5} strokeDasharray="3 4" />
          <path d={g.spend} fill="none" className="stroke-spend" strokeWidth={2} strokeLinejoin="round" />
          <path d={g.rev} fill="none" className="stroke-revenue" strokeWidth={2} strokeLinejoin="round" />
          {/* direct labels at line ends */}
          <EndLabel x={g.x(g.n - 1)} y={g.yTop(last.cumRevenue)} text={inr(last.cumRevenue)} cls="fill-revenue" />
          <EndLabel x={g.x(g.n - 1)} y={g.yTop(last.cumSpend)} text={inr(last.cumSpend)} cls="fill-spend" nudge={g.yTop(last.cumSpend) - g.yTop(last.cumRevenue) < 18 ? 14 : 0} />

          {/* bottom panel: profit, its own scale, with a zero line */}
          <text x={PAD.l} y={g.botTop - 10} className="fill-ink-2 text-[12px] font-semibold">Profit, cumulative <tspan className="fill-ink-3 font-normal">(estimate)</tspan></text>
          <defs>
            <clipPath id="above"><rect x={0} y={0} width={w} height={g.zeroY} /></clipPath>
            <clipPath id="below"><rect x={0} y={g.zeroY} width={w} height={H} /></clipPath>
          </defs>
          <path d={g.profitArea} className="fill-good/15" clipPath="url(#above)" />
          <path d={g.profitArea} className="fill-bad/20" clipPath="url(#below)" />
          <line x1={PAD.l} x2={w - PAD.r} y1={g.zeroY} y2={g.zeroY} className="stroke-ink-3" strokeDasharray="2 3" />
          <text x={PAD.l - 10} y={g.zeroY} dy="0.35em" textAnchor="end" className="fill-ink-3 text-[11px]">₹0</text>
          {g.hi > 0 && <text x={PAD.l - 10} y={g.yBot(g.hi)} dy="0.35em" textAnchor="end" className="fill-ink-3 text-[11px]">{short(g.hi)}</text>}
          {g.lo < 0 && <text x={PAD.l - 10} y={g.yBot(g.lo)} dy="0.35em" textAnchor="end" className="fill-ink-3 text-[11px]">{short(g.lo)}</text>}
          <path d={g.profitPath} fill="none" className="stroke-ink" strokeWidth={2} strokeLinejoin="round" />
          <EndLabel x={g.x(g.n - 1)} y={g.yBot(last.cumProfit)} text={inr(last.cumProfit)} cls={last.cumProfit < 0 ? 'fill-bad' : 'fill-ink'} />

          {/* x labels */}
          {points.map((p, i) => (i % g.labelEvery === 0 || i === g.n - 1) && (
            <text key={p.key} x={g.x(i)} y={H - 6} textAnchor="middle" className="fill-ink-3 text-[11px]">{p.label}</text>
          ))}

          {/* hover */}
          {hp && hover !== null && (
            <g pointerEvents="none">
              <line x1={g.x(hover)} x2={g.x(hover)} y1={PAD.t} y2={g.botTop + BOT_H} className="stroke-ink-3" />
              <circle cx={g.x(hover)} cy={g.yTop(hp.cumRevenue)} r={4} className="fill-revenue stroke-ground" strokeWidth={2} />
              <circle cx={g.x(hover)} cy={g.yTop(hp.cumSpend)} r={4} className="fill-spend stroke-ground" strokeWidth={2} />
              <circle cx={g.x(hover)} cy={g.yBot(hp.cumProfit)} r={4} className="fill-ink stroke-ground" strokeWidth={2} />
            </g>
          )}
          <rect x={PAD.l} y={0} width={g.plotW} height={H} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>

        {hp && hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 w-56 rounded-lg border border-line-strong bg-raised-2/95 p-3 text-sm shadow-[0_8px_24px_rgb(0_0_0/0.45)]"
            style={{ left: Math.min(Math.max(g.x(hover) + 14, 0), w - 232) }}
          >
            <p className="font-semibold text-ink">{hp.label}</p>
            <dl className="mt-2 grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 text-ink-2">
              <dt className="text-ink-3" /> <dd className="text-right text-xs text-ink-3">this {unit}</dd><dd className="text-right text-xs text-ink-3">so far</dd>
              <dt className="flex items-center gap-2"><span className="size-2 rounded-full bg-revenue" />Revenue</dt><dd className="text-right">{inr(hp.revenue)}</dd><dd className="text-right text-ink">{inr(hp.cumRevenue)}</dd>
              <dt className="flex items-center gap-2"><span className="size-2 rounded-full bg-spend" />Spend</dt><dd className="text-right">{inr(hp.spend)}</dd><dd className="text-right text-ink">{inr(hp.cumSpend)}</dd>
              <dt className="flex items-center gap-2"><span className="size-2 rounded-full bg-ink" />Profit</dt><dd className={`text-right ${hp.profit < 0 ? 'text-bad' : ''}`}>{inr(hp.profit)}</dd><dd className={`text-right ${hp.cumProfit < 0 ? 'text-bad' : 'text-ink'}`}>{inr(hp.cumProfit)}</dd>
            </dl>
          </div>
        )}
      </div>
    </figure>
  )
}

function EndLabel({ x, y, text, cls, nudge = 0 }: { x: number; y: number; text: string; cls: string; nudge?: number }) {
  return <text x={x + 10} y={y + nudge} dy="0.35em" className={`${cls} text-[12px] font-semibold`}>{text}</text>
}
