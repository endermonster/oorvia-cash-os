'use client'

import { useEffect, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import StatCard   from '@/components/shared/StatCard'
import { fmtINR } from '@/lib/pnl'
import { addMonths, currentMonth, fmtMonth, monthEnd, monthStart, monthsBetween } from '@/lib/dates'

const TRACKING_START = '2026-03'

function fmtL(n) {
  const abs = Math.abs(n)
  if (abs >= 100000) return `${(abs / 100000).toFixed(1)}L`
  if (abs >= 1000)   return `${(abs / 1000).toFixed(0)}k`
  return String(Math.round(abs))
}

function CumulativeChart({ series, projections, breakEvenMonth }) {
  const allPoints = [...series, ...projections]
  if (allPoints.length < 2) return null

  const W = 700, H = 220
  const PAD = { left: 56, right: 20, top: 20, bottom: 36 }
  const pw = W - PAD.left - PAD.right
  const ph = H - PAD.top - PAD.bottom

  const yVals = allPoints.map(p => p.cumulative)
  const rawMin = Math.min(...yVals)
  const rawMax = Math.max(...yVals, 0)
  const pad    = Math.max(Math.abs(rawMax - rawMin) * 0.12, 5000)
  const yMin   = rawMin - pad
  const yMax   = rawMax + pad

  function xOf(i) { return PAD.left + (i / (allPoints.length - 1)) * pw }
  function yOf(v) { return PAD.top + ph - ((v - yMin) / (yMax - yMin)) * ph }

  const zeroY = yOf(0)

  // Y-axis ticks (5 evenly spaced)
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const v = yMin + (yMax - yMin) * (i / 4)
    return { v, y: yOf(v) }
  })

  // Build SVG path segments
  const actualCoords = series.map((p, i) => ({ x: xOf(i), y: yOf(p.cumulative) }))
  const projCoords   = projections.map((p, i) => ({ x: xOf(series.length + i), y: yOf(p.cumulative) }))

  const actualPath = actualCoords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x},${c.y}`).join(' ')
  const projPath   = projCoords.length > 0
    ? [`M${actualCoords[actualCoords.length - 1].x},${actualCoords[actualCoords.length - 1].y}`,
       ...projCoords.map(c => `L${c.x},${c.y}`)].join(' ')
    : ''

  // Clip area below zero for red fill
  const areaActual = actualCoords.length > 0
    ? `${actualPath} L${actualCoords[actualCoords.length - 1].x},${zeroY} L${actualCoords[0].x},${zeroY} Z`
    : ''

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 210 }}>
      <defs>
        <clipPath id="belowZero">
          <rect x={PAD.left} y={zeroY} width={pw} height={H - zeroY} />
        </clipPath>
        <clipPath id="aboveZero">
          <rect x={PAD.left} y={PAD.top} width={pw} height={zeroY - PAD.top} />
        </clipPath>
      </defs>

      {/* Grid + y-axis ticks */}
      {ticks.map(({ v, y }, i) => (
        <g key={i}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y}
            stroke={Math.abs(v) < (yMax - yMin) * 0.04 ? '#52525b' : '#1f1f2e'}
            strokeWidth={Math.abs(v) < (yMax - yMin) * 0.04 ? 1 : 0.5} />
          <text x={PAD.left - 6} y={y + 3.5} textAnchor="end" fontSize={9} fill={Math.abs(v) < (yMax - yMin) * 0.04 ? '#a1a1aa' : '#52525b'}>
            {v < -100 || v > 100 ? `${v < 0 ? '−' : '+'}${fmtL(v)}` : '0'}
          </text>
        </g>
      ))}

      {/* Zero line label */}
      <text x={PAD.left - 6} y={zeroY + 3.5} textAnchor="end" fontSize={9} fill="#a1a1aa" fontWeight="600">0</text>

      {/* Area fills */}
      {areaActual && (
        <>
          <path d={areaActual} fill="#ef4444" fillOpacity="0.07" clipPath="url(#belowZero)" />
          <path d={areaActual} fill="#22c55e" fillOpacity="0.07" clipPath="url(#aboveZero)" />
        </>
      )}

      {/* Actual line */}
      {actualPath && (
        <path d={actualPath} fill="none" stroke="#f87171" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" />
      )}

      {/* Projection line (dashed green) */}
      {projPath && (
        <path d={projPath} fill="none" stroke="#4ade80" strokeWidth="2"
          strokeDasharray="6 3" strokeLinecap="round" strokeLinejoin="round" />
      )}

      {/* Dots for each actual point */}
      {actualCoords.map((c, i) => {
        const p = series[i]
        return (
          <circle key={p.id} cx={c.x} cy={c.y} r={3}
            fill={p.cumulative >= 0 ? '#4ade80' : '#f87171'}
            stroke="#0f172a" strokeWidth="1.5" />
        )
      })}

      {/* Dots for projection */}
      {projCoords.map((c, i) => {
        const p = projections[i]
        const isBE = p.id === breakEvenMonth
        return (
          <g key={p.id}>
            <circle cx={c.x} cy={c.y} r={isBE ? 5 : 2.5}
              fill={isBE ? '#4ade80' : '#4ade80'} opacity={isBE ? 1 : 0.5}
              stroke={isBE ? '#020617' : 'none'} strokeWidth={1.5} />
            {isBE && (
              <circle cx={c.x} cy={c.y} r={9} fill="none"
                stroke="#4ade80" strokeWidth="1" opacity="0.4" />
            )}
          </g>
        )
      })}

      {/* X-axis labels */}
      {allPoints.map((p, i) => {
        const x = xOf(i)
        const label = p.isBaseline ? 'Pre-GST' : p.label.replace(' 2026', "'26").replace(' 2027', "'27")
        return (
          <text key={p.id} x={x} y={H - 4} textAnchor="middle" fontSize={9}
            fill={p.isProjected ? '#3f3f52' : '#71717a'}
            fontStyle={p.isProjected ? 'italic' : 'normal'}>
            {label}
          </text>
        )
      })}

      {/* Break-even label */}
      {breakEvenMonth && projCoords.length > 0 && (() => {
        const beIdx = projections.findIndex(p => p.id === breakEvenMonth)
        if (beIdx < 0) return null
        const c = projCoords[beIdx]
        return (
          <text x={c.x} y={c.y - 12} textAnchor="middle" fontSize={8.5} fill="#4ade80" fontWeight="600">
            Break-even
          </text>
        )
      })()}
    </svg>
  )
}

function r2(n) { return Math.round(n * 100) / 100 }

export default function ForecastPage() {
  const [baseline, setBaseline] = useState(null)
  const [monthlyPnL, setMonthlyPnL] = useState({})
  const [loading, setLoading]   = useState(true)
  const [err, setErr]           = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const bRes = await fetch('/api/baseline')
        const b    = await bRes.json()
        if (b.error) throw new Error(b.error)
        setBaseline(b)

        const now    = currentMonth()
        const months = monthsBetween(TRACKING_START, now)

        const entries = await Promise.all(
          months.map(async ym => {
            const res = await fetch(`/api/pnl?from=${monthStart(ym)}&to=${monthEnd(ym)}`)
            const d   = await res.json()
            return [ym, d]
          })
        )
        setMonthlyPnL(Object.fromEntries(entries))
      } catch (e) {
        setErr(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <p className="text-slate-400 text-sm">Loading…</p>
  if (err)     return <p className="text-red-400 text-sm">{err}</p>
  if (!baseline) return <p className="text-slate-400 text-sm">No baseline found. Run the SQL setup.</p>

  const now            = currentMonth()
  const trackedMonths  = monthsBetween(TRACKING_START, now)
  const completedMonths = trackedMonths.slice(0, -1) // exclude current in-progress month

  // Build actual series (cumulative running from baseline)
  let cumulative = Number(baseline.net_pnl)
  const series = []

  series.push({
    id:          'pre-gst',
    label:       'Pre-GST (inception → 13 Mar)',
    net:         Number(baseline.net_pnl),
    cumulative:  Number(baseline.net_pnl),
    isBaseline:  true,
  })

  for (const ym of trackedMonths) {
    const net = r2(monthlyPnL[ym]?.net_profit ?? 0)
    cumulative = r2(cumulative + net)
    series.push({
      id:          ym,
      label:       fmtMonth(ym),
      net,
      cumulative,
      isActual:    true,
      isInProgress: ym === now,
    })
  }

  // Trailing average from completed months only
  const trailingAvg = completedMonths.length > 0
    ? r2(completedMonths.reduce((s, ym) => s + (monthlyPnL[ym]?.net_profit ?? 0), 0) / completedMonths.length)
    : 0

  // Forward projection (only if trailing average is positive)
  const projections = []
  let breakEvenMonth = null

  if (trailingAvg > 0) {
    let projCum = cumulative
    for (let i = 1; i <= 30; i++) {
      const projMonth = addMonths(now, i)
      projCum = r2(projCum + trailingAvg)
      projections.push({
        id:          projMonth,
        label:       fmtMonth(projMonth),
        net:         trailingAvg,
        cumulative:  projCum,
        isProjected: true,
      })
      if (!breakEvenMonth && projCum >= 0) {
        breakEvenMonth = projMonth
        break
      }
    }
  }

  const allRows    = [...series, ...projections]
  const maxAbsNet  = Math.max(...allRows.map(r => Math.abs(r.net)), 1)
  const thisMonthNet = r2(monthlyPnL[now]?.net_profit ?? 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profitability Forecast"
        subtitle="Cumulative P&L from Day 1, with break-even projection"
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          title="Total Loss (Day 1)"
          value={fmtINR(Math.abs(cumulative))}
          subtitle="Pre-GST + all tracked months"
          color={cumulative < 0 ? 'red' : 'green'}
        />
        <StatCard
          title={`${fmtMonth(now)} (in progress)`}
          value={fmtINR(Math.abs(thisMonthNet))}
          subtitle={thisMonthNet >= 0 ? 'Net profit so far' : 'Net loss so far'}
          color={thisMonthNet >= 0 ? 'green' : 'red'}
        />
        <StatCard
          title="Trailing Avg / Month"
          value={completedMonths.length > 0 ? fmtINR(Math.abs(trailingAvg)) : '—'}
          subtitle={
            completedMonths.length === 0 ? 'Need 1 complete month'
            : trailingAvg >= 0 ? `${completedMonths.length}-mo avg profit`
            : `${completedMonths.length}-mo avg loss`
          }
          color={trailingAvg >= 0 ? 'green' : 'red'}
        />
        <StatCard
          title="Break-Even"
          value={breakEvenMonth ? fmtMonth(breakEvenMonth) : '—'}
          subtitle={
            breakEvenMonth          ? 'Projected (cumulative)'
            : trailingAvg > 0       ? 'Calculating…'
            : completedMonths.length === 0 ? 'Need more data'
            : 'Monthly net must turn positive'
          }
          color={breakEvenMonth ? 'blue' : 'zinc'}
        />
      </div>

      {/* SVG cumulative chart */}
      <div className="rounded-2xl border border-[rgb(30 41 59 / 0.6)] bg-slate-900/80 p-5">
        <h3 className="text-sm font-semibold text-slate-100 mb-1">Cumulative P&L — Day 1 to Break-Even</h3>
        <p className="text-xs text-slate-500 mb-4">
          Running total from inception.
          {projections.length > 0
            ? ' Dashed green = projection at current trajectory.'
            : ' Projection appears once monthly average turns positive.'}
        </p>
        <CumulativeChart series={series} projections={projections} breakEvenMonth={breakEvenMonth} />
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5 bg-red-400 rounded" /> Actual (loss)</span>
          {projections.length > 0 && <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5 bg-green-400 rounded" style={{backgroundImage:'repeating-linear-gradient(90deg,#4ade80 0,#4ade80 6px,transparent 6px,transparent 9px)'}} /> Projected</span>}
          <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5 bg-slate-500 rounded" /> Break-even (₹0)</span>
        </div>
      </div>

      {/* Monthly detail rows */}
      <div className="rounded-2xl border border-[rgb(30 41 59 / 0.6)] bg-slate-900/80 p-5">
        <h3 className="text-sm font-semibold text-slate-100 mb-1">Monthly Net + Cumulative P&L</h3>
        <p className="text-xs text-slate-500 mb-5">
          Bars = monthly net. Right column = running total from inception.
          {projections.length > 0 && ' Faded rows = projection at current trajectory.'}
        </p>

        {/* Column headers */}
        <div className="flex items-center gap-3 mb-2 text-[10px] uppercase tracking-widest text-slate-600">
          <span className="w-44 shrink-0">Period</span>
          <span className="flex-1">Monthly Net</span>
          <span className="w-24 shrink-0 text-right">Monthly</span>
          <span className="w-28 shrink-0 text-right">Cumulative</span>
        </div>

        <div className="space-y-1.5">
          {allRows.map(row => {
            const barPct   = Math.max(0, Math.min(100, (Math.abs(row.net) / maxAbsNet) * 100))
            const positive = row.net >= 0
            const barColor = row.isProjected
              ? (positive ? 'bg-green-600/35' : 'bg-red-600/35')
              : row.isBaseline
                ? 'bg-red-700'
                : (positive ? 'bg-green-600' : 'bg-red-600')
            const netColor = row.isProjected
              ? (positive ? 'text-green-400/60' : 'text-red-400/60')
              : (positive ? 'text-green-400' : 'text-red-400')
            const cumColor = row.isProjected
              ? (row.cumulative >= 0 ? 'text-green-400/60' : 'text-red-400/60')
              : (row.cumulative >= 0 ? 'text-green-400' : 'text-red-400')

            return (
              <div
                key={row.id}
                className={`flex items-center gap-3 ${row.isBaseline ? 'pb-2 mb-1 border-b border-slate-800' : ''}`}
              >
                <span className={`w-44 shrink-0 text-xs ${row.isProjected ? 'text-slate-500 italic' : row.isInProgress ? 'text-slate-300' : 'text-slate-400'}`}>
                  {row.label}
                  {row.isInProgress && <span className="ml-1 text-[10px] text-slate-600">(in progress)</span>}
                </span>
                <div className="flex-1 h-5 rounded bg-slate-800 overflow-hidden">
                  <div className={`h-full rounded transition-all ${barColor}`} style={{ width: `${barPct}%` }} />
                </div>
                <span className={`w-24 shrink-0 text-right text-xs font-semibold tabular-nums ${netColor}`}>
                  {positive ? '+' : '−'}{fmtINR(Math.abs(row.net))}
                </span>
                <span className={`w-28 shrink-0 text-right text-xs font-semibold tabular-nums ${cumColor}`}>
                  {row.cumulative >= 0 ? '+' : '−'}{fmtINR(Math.abs(row.cumulative))}
                </span>
              </div>
            )
          })}
        </div>

        <div className="mt-4 pt-3 border-t border-slate-800 flex flex-wrap gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-green-600 inline-block" /> Monthly profit
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-red-600 inline-block" /> Monthly loss
          </span>
          {projections.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-slate-600/60 inline-block" /> Projected
            </span>
          )}
          <span className="ml-auto">Right column = running total from Day 1</span>
        </div>
      </div>

      {/* Break-even detail table */}
      {projections.length > 0 && (
        <div className="rounded-2xl border border-[rgb(30 41 59 / 0.6)] bg-slate-900/80 p-5">
          <h3 className="text-sm font-semibold text-slate-100 mb-1">Break-Even Projection</h3>
          <p className="text-xs text-slate-500 mb-4">
            Based on {completedMonths.length}-month trailing average of{' '}
            <span className={trailingAvg >= 0 ? 'text-green-400' : 'text-red-400'}>
              {trailingAvg >= 0 ? '+' : '−'}{fmtINR(Math.abs(trailingAvg))}/month
            </span>
          </p>
          <div className="rounded-xl border border-slate-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-xs text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">Month</th>
                  <th className="px-4 py-3 text-right">Projected Net</th>
                  <th className="px-4 py-3 text-right">Cumulative</th>
                  <th className="px-4 py-3 text-right">Still to Recover</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {projections.map(row => (
                  <tr
                    key={row.id}
                    className={`hover:bg-slate-800/40 ${row.id === breakEvenMonth ? 'bg-green-900/20' : ''}`}
                  >
                    <td className="px-4 py-3 text-slate-300">
                      {fmtMonth(row.id)}
                      {row.id === breakEvenMonth && (
                        <span className="ml-2 text-xs font-semibold text-green-400">Break-even</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-green-400 font-medium">
                      +{fmtINR(row.net)}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums font-medium ${row.cumulative >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {row.cumulative >= 0 ? '+' : '−'}{fmtINR(Math.abs(row.cumulative))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-400">
                      {row.cumulative < 0 ? fmtINR(Math.abs(row.cumulative)) : '✓ Recovered'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Warning: negative trajectory */}
      {trailingAvg <= 0 && completedMonths.length > 0 && (
        <div className="rounded-xl border border-yellow-800/40 bg-yellow-900/10 px-5 py-4 text-sm text-yellow-400">
          Monthly net is currently averaging{' '}
          <span className="font-semibold">−{fmtINR(Math.abs(trailingAvg))}/month</span>.
          Break-even projection requires a positive monthly average.
          Once a month closes net-positive, the projection will appear here.
        </div>
      )}
    </div>
  )
}
