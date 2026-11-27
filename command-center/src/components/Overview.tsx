import { hourLabel, inr, type Period, type Portfolio, type SeriesPoint } from '@/lib/metrics'
import { Delta } from './bits'
import { Sparkline } from './Sparkline'

type Card = {
  /** `short`: the label on phones. `prev` null: no comparison (an average over no orders). */
  k: string; label: string; short?: string; source: string; value: string; now: number | null; prev: number | null
  goodWhenUp?: boolean; neutral?: boolean
  values: (number | null)[]; kind: 'money' | 'count'; stroke: string; fill: string; dot: string
  /** Under the sparkline: why its buckets fall short of the headline figure. */
  note?: string
  /** In place of the change: why there is no sound comparison. */
  noCompare?: string
}

/** Hours 0 to now, a quiet hour as zero revenue, orders and spend (its AOV a gap). Only the per-bucket fields are read. */
function everyHour(points: SeriesPoint[], nowHour: number): SeriesPoint[] {
  const byHour = new Map(points.map((p) => [Number(p.key), p]))
  const last = Math.max(nowHour, ...byHour.keys())
  return Array.from({ length: last + 1 }, (_, h) => byHour.get(h) ?? {
    key: String(h), label: hourLabel(h), revenue: 0, orders: 0, spend: 0, profit: 0, cumRevenue: 0, cumSpend: 0, cumProfit: 0, prevCumRevenue: null,
  })
}

/**
 * The plain read of the period, before any estimate: booked revenue, orders, average order value and ad spend,
 * each against the previous period and drawn per bucket (hours for Today, days otherwise). All VXP.
 */
export function Overview({ total, series: points, period, nowHour, prevHoursComplete = true }: {
  total: Portfolio['total']; series: SeriesPoint[]; period: Period; nowHour: number
  /** Yesterday's hourly spend adds up to its day (metrics.yesterdayHoursComplete): Today's spend comparison rests on it. */
  prevHoursComplete?: boolean
}) {
  // Today's series holds only hours with activity: every hour from midnight to now keeps the chart in clock time.
  const series = period.id === 'today' ? everyHour(points, nowHour) : points
  const aov = total.orders > 0 ? total.revenue / total.orders : null
  const prevAov = total.prevOrders > 0 ? total.prevRevenue / total.prevOrders : null
  // Nothing at all before: history starts later (Shopify from March 2026), so it reads as no data, not as ₹0.
  const noPrev = total.prevOrders === 0 && total.prevRevenue === 0 && total.prevSpend === 0
  // Meta's hourly split can lag its daily total (HANDOFF-meta-sync.md): the headline is the daily figure, so say
  // when the hours under it do not add up to it rather than drawing the missing spend as quiet hours.
  const hourlySpend = series.reduce((s, p) => s + p.spend, 0)
  const spendNote = period.id === 'today' && total.spend - hourlySpend >= 1
    ? `Hourly split incomplete: ${inr(hourlySpend)} of ${inr(total.spend)} by hour` : undefined
  const cards: Card[] = [
    { k: 'rev', label: 'Revenue', source: 'Shopify', value: inr(total.revenue), now: total.revenue, prev: total.prevRevenue,
      values: series.map((p) => p.revenue), kind: 'money', stroke: 'stroke-revenue', fill: 'fill-revenue/12', dot: 'bg-revenue' },
    { k: 'orders', label: 'Orders', source: 'Shopify', value: total.orders.toLocaleString('en-IN'), now: total.orders, prev: total.prevOrders,
      values: series.map((p) => p.orders), kind: 'count', stroke: 'stroke-ink-2', fill: 'fill-ink-2/10', dot: 'bg-ink-2' },
    { k: 'aov', label: 'Avg order value', short: 'AOV', source: 'Shopify', value: aov === null ? '—' : inr(aov), now: aov, prev: prevAov,
      values: series.map((p) => (p.orders > 0 ? p.revenue / p.orders : null)), kind: 'money', stroke: 'stroke-ink-2', fill: 'fill-ink-2/10', dot: 'bg-ink-2' },
    { k: 'spend', label: 'Ad spend', source: 'Meta', value: inr(total.spend), now: total.spend, prev: total.prevSpend, neutral: true,
      values: series.map((p) => p.spend), kind: 'money', stroke: 'stroke-spend', fill: 'fill-spend/12', dot: 'bg-spend', note: spendNote,
      noCompare: period.id === 'today' && !prevHoursComplete ? "no comparison: yesterday's hourly split incomplete" : undefined },
  ]
  const labels = series.map((p) => p.label)

  return (
    <section aria-label={`Overview · ${period.range}`} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {/* A custom range's dates in view: on a phone its pill can sit scrolled away, and "7D" alone reads as the last 7 days. */}
      {period.id === 'custom' && (
        <p className="label col-span-full -mb-1 px-1">Custom range <span className="font-normal normal-case tracking-normal text-ink-2">· {period.range} · {period.short}</span></p>
      )}
      {cards.map((c, i) => (
        <div key={c.k} className="glass rise flex min-w-0 flex-col px-4 pb-3 pt-3.5 sm:px-5 sm:pt-4" style={{ '--delay': `${i * 40}ms` } as React.CSSProperties}>
          {/* One line from sm up; on a phone's narrow card the source drops to a second line instead of being cut. */}
          <p className="label sm:truncate">
            <span className="block truncate sm:inline">
              {c.short ? <><span className="sm:hidden">{c.short}</span><span className="hidden sm:inline">{c.label}</span></> : c.label}
              <span className="font-normal normal-case tracking-normal text-ink-3"> · {period.short}</span>
            </span>
            <span className="block truncate font-normal normal-case tracking-normal text-ink-3 sm:inline"><span className="max-sm:hidden"> · </span>{c.source}</span>
          </p>
          <p className="mt-1.5 whitespace-nowrap text-[clamp(1.2rem,5.2vw,1.6rem)] font-extrabold leading-none tracking-[-0.03em] tabular-nums sm:text-[2rem]">{c.value}</p>
          {/* The comparison wraps whole under the change on a narrow card, never word by word beside it. */}
          <div className="mt-1.5 flex min-h-5 flex-wrap items-center gap-x-1 text-sm text-ink-3">
            {noPrev ? <span>no data for {period.prevLabel}</span>
              : c.noCompare ? <span>{c.noCompare}</span>
              : c.now === null || c.prev === null ? <span>no comparison: no orders {c.now === null ? 'this period' : period.prevLabel}</span>
              : c.prev > 0 ? <><Delta now={c.now} prev={c.prev} goodWhenUp={c.goodWhenUp ?? true} neutral={c.neutral} /><span>vs {period.prevLabel}</span></>
              : <span>vs {c.kind === 'money' ? inr(0) : '0'} {period.prevLabel}</span>}
          </div>
          <div className="mt-auto pt-3">
            <Sparkline values={c.values} labels={labels} kind={c.kind} stroke={c.stroke} fill={c.fill} dot={c.dot} name={c.label} />
            {c.note && <p className="mt-1 text-xs text-warn">{c.note}</p>}
          </div>
        </div>
      ))}
    </section>
  )
}
