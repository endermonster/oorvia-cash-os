'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Forecast } from '@/lib/forecast'
import { inr } from '@/lib/metrics'
import { monthsBetween } from '@/lib/pnl'

type PlotPoint = { x: number; value: number }

/** The point where a straight segment crosses zero strictly between its endpoints. */
export function splitAtZero(from: PlotPoint, to: PlotPoint): PlotPoint | null {
  if (from.value === 0 || to.value === 0 || Math.sign(from.value) === Math.sign(to.value)) return null
  const fraction = -from.value / (to.value - from.value)
  return { x: from.x + fraction * (to.x - from.x), value: 0 }
}

/** Whole-rupee grid intervals, with zero always on a tick. Values are in paise. */
export function forecastTicks(values: number[]): number[] {
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  if (min === max) return [0]

  const roughStep = Math.max(100, (max - min) / 4)
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const multiple = [1, 2, 2.5, 5, 10].find((n) => n >= roughStep / magnitude) ?? 10
  const step = magnitude * multiple
  const first = Math.floor(min / step)
  // All-loss data: add one step of headroom so the ₹0 line sits inside the plot with room for its label.
  const last = max <= 0 ? 1 : Math.ceil(max / step)
  return Array.from({ length: last - first + 1 }, (_, i) => (first + i) * step + 0)
}

export function formatForecastTick(paise: number): string {
  const rupees = Math.abs(paise) / 100
  const sign = paise < 0 ? '−' : ''
  if (rupees >= 100_000) return `${sign}₹${+(rupees / 100_000).toFixed(1)}L`
  if (rupees >= 1_000) return `${sign}₹${+(rupees / 1_000).toFixed(1)}k`
  return inr(paise / 100)
}

const HEIGHT = 214
const PAD = { left: 68, right: 16, top: 24, bottom: 168 }
const axisMonth = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' })
const detailMonth = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const monthDate = (month: string) => new Date(`${month}-01T00:00:00Z`)
const amountColor = (value: number) => value < 0 ? 'var(--color-bad)' : value > 0 ? 'var(--color-good)' : 'var(--color-ink-2)'

function Amount({ paise }: { paise: number }) {
  const absolute = Math.abs(paise)
  const remainder = absolute % 100
  const tone = paise < 0 ? 'text-bad' : paise > 0 ? 'text-good' : 'text-ink-2'
  return (
    <span className={`font-semibold tabular-nums ${tone}`}>
      {paise < 0 ? '−' : paise > 0 ? '+' : ''}{inr(Math.floor(absolute / 100))}{remainder ? `.${String(remainder).padStart(2, '0')}` : ''}
    </span>
  )
}

export function ForecastChart({ forecast }: { forecast: Forecast }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [active, setActive] = useState<number | null>(null)
  const tip = useRef<HTMLDivElement>(null)
  const [tipWidth, setTipWidth] = useState(0)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const { opening, rows, breakEven } = forecast
  const firstMonth = rows[0]?.month
  const ticks = forecastTicks([opening.netPaise, ...rows.map((row) => row.cumulative)])
  const [min, max] = ticks.length === 1 ? [-1, 1] : [ticks[0], ticks[ticks.length - 1]]
  const y = (value: number) => PAD.bottom - (value - min) / (max - min) * (PAD.bottom - PAD.top)
  const zero = y(0)
  const plotWidth = width - PAD.left - PAD.right
  const monthOffset = (month: string) => firstMonth ? monthsBetween(firstMonth, month) + 1 : 1
  const lastMonth = rows.at(-1)?.month
  const actualMonths = lastMonth ? monthOffset(lastMonth) : 0
  const totalMonths = breakEven ? monthOffset(breakEven) : actualMonths
  const actualShare = totalMonths ? actualMonths / totalMonths : 1
  const compressed = actualShare < 0.6
  const actualWidth = Math.max(0.6, actualShare) * plotWidth
  const x = (offset: number) => PAD.left + (actualMonths ? offset / actualMonths * actualWidth : plotWidth / 2)
  const points = [
    { x: x(0), value: opening.netPaise, row: null },
    ...rows.map((row) => ({ x: x(monthOffset(row.month)), value: row.cumulative, row })),
  ]
  const last = points[points.length - 1]
  const selected = active === null ? null : points[active]
  const segments = points.slice(1).flatMap((to, i) => {
    const from = points[i]
    const crossing = splitAtZero(from, to)
    return crossing ? [[from, crossing], [crossing, to]] : [[from, to]]
  })

  // The opening and latest labels are always shown; the months between are thinned by pixel spacing.
  const projectionX = breakEven ? width - PAD.right : null
  const labelled = new Set([0, points.length - 1])
  let nextLabel = last.x
  for (let i = points.length - 2; i >= 1; i--) {
    if (nextLabel - points[i].x < 60 || points[i].x - points[0].x < 60) continue
    labelled.add(i)
    nextLabel = points[i].x
  }

  useLayoutEffect(() => {
    if (tip.current) setTipWidth(tip.current.offsetWidth)
  }, [active, width])

  function inspect(clientX: number, left: number) {
    const position = clientX - left
    if (projectionX !== null && position > last.x + Math.min(20, (projectionX - last.x) / 2)) {
      setActive(null)
      return
    }
    const closest = points.reduce((best, point, i) =>
      Math.abs(point.x - position) < Math.abs(points[best].x - position) ? i : best, 0)
    setActive(closest)
  }

  return (
    <div ref={wrap} className="relative mt-3 min-w-0" style={{ height: HEIGHT }}
      role="group" aria-label="Running total from Day 1. Use the left and right arrow keys to inspect months."
      tabIndex={0} onFocus={() => setActive((index) => index ?? points.length - 1)} onBlur={() => setActive(null)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setActive(null)
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        const step = event.key === 'ArrowLeft' ? -1 : 1
        setActive((index) => index === null ? points.length - 1 : Math.min(points.length - 1, Math.max(0, index + step)))
      }}>
      {plotWidth > 0 && (
        <svg width={width} height={HEIGHT} role="img" className="block"
          aria-label={`Cumulative net profit from Day 1, by month${compressed ? '. Projection time scale compressed' : ''}`}
          onPointerMove={(event) => {
            if (event.pointerType !== 'touch') inspect(event.clientX, event.currentTarget.getBoundingClientRect().left)
          }}
          onPointerDown={(event) => inspect(event.clientX, event.currentTarget.getBoundingClientRect().left)}
          onPointerLeave={(event) => { if (event.pointerType !== 'touch') setActive(null) }}
          onPointerCancel={() => setActive(null)}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)}
                style={{ stroke: tick === 0 ? 'var(--color-line-strong)' : 'var(--color-line)' }} />
              <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="text-xs tabular-nums"
                style={{ fill: tick === 0 ? 'var(--color-ink-2)' : 'var(--color-ink-3)' }}>{formatForecastTick(tick)}</text>
            </g>
          ))}
          {segments.map(([from, to], i) => {
            if (from.value === 0 && to.value === 0) return null
            const color = amountColor(from.value || to.value)
            const line = `M${from.x},${y(from.value)}L${to.x},${y(to.value)}`
            return (
              <g key={i}>
                <path d={`${line}L${to.x},${zero}L${from.x},${zero}Z`} style={{ fill: color }} fillOpacity={0.14} />
                <path d={line} style={{ fill: 'none', stroke: color }} strokeWidth={2.25} />
              </g>
            )
          })}
          {breakEven && projectionX !== null && (
            <g>
              {compressed && (
                <path d={`M${last.x - 5},${PAD.bottom + 4}l4,-8m1,8l4,-8`}
                  style={{ fill: 'none', stroke: 'var(--color-ink-2)' }} />
              )}
              <line x1={last.x} x2={projectionX} y1={y(last.value)} y2={zero} strokeWidth={2}
                strokeDasharray="5 4" opacity={0.7} style={{ stroke: 'var(--color-bad)' }} />
              <circle cx={projectionX} cy={zero} r={3} style={{ fill: 'var(--color-ink-2)' }} />
              <text x={projectionX} y={12} textAnchor="end" className="text-xs" style={{ fill: 'var(--color-ink-2)' }}>
                Break-even · {detailMonth.format(monthDate(breakEven))}
              </text>
            </g>
          )}
          {selected && (
            <line x1={selected.x} x2={selected.x} y1={PAD.top} y2={PAD.bottom}
              strokeDasharray="3 3" style={{ stroke: 'var(--color-ink-3)' }} />
          )}
          {points.map(({ x, value, row }, i) => (
            <g key={row?.month ?? 'opening'}>
              <circle cx={x} cy={y(value)} r={row?.partial || selected === points[i] ? 4.5 : 2.75} strokeWidth={1.75}
                style={{ fill: row?.partial ? 'var(--color-raised)' : amountColor(value), stroke: amountColor(value) }} />
              {labelled.has(i) && (
                <text x={x} y={PAD.bottom + 20} textAnchor={i === points.length - 1 ? 'end' : 'middle'}
                  className="text-xs" style={{ fill: 'var(--color-ink-3)' }}>
                  {row ? axisMonth.format(monthDate(row.month)) : 'Day 1'}
                  {row?.partial && <tspan x={x} dy="1.2em">so far</tspan>}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
      <div aria-live="polite">
        {plotWidth > 0 && selected && (
          <div ref={tip} className="pointer-events-none absolute top-0 w-max max-w-full rounded-xl bg-raised px-3 py-2 text-xs text-ink-2 ring-1 ring-line-strong"
            style={{ left: Math.max(0, Math.min(width - tipWidth, selected.x + 10 + tipWidth <= width ? selected.x + 10 : selected.x - 10 - tipWidth)) }}>
            <p className="font-semibold text-ink">
              {selected.row ? detailMonth.format(monthDate(selected.row.month)) : 'Day 1 · Opening result'}{selected.row?.partial && ' · so far'}
            </p>
            {selected.row && <p className="mt-1">Net profit <Amount paise={selected.row.net} /></p>}
            <p>Running total <Amount paise={selected.value} /></p>
          </div>
        )}
      </div>
    </div>
  )
}
