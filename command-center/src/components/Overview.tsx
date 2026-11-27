import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { hourLabel, inr, type Period, type Portfolio, type SeriesPoint, type StoreStats } from '@/lib/metrics'
import { Delta } from './bits'
import { SquareBars } from './SquareBars'

type Kind = 'money' | 'count'
export type CardKey = 'rev' | 'orders' | 'aov' | 'spend'
type Card = {
  /** `short`: the label on phones. `prev` null: no comparison (an average over no orders). */
  k: CardKey; label: string; short?: string; source: string; value: string; now: number | null; prev: number | null
  goodWhenUp?: boolean; neutral?: boolean
  values: (number | null)[]; den?: number[]; kind: Kind; merge: 'sum' | 'ratio'; lit: boolean
  /** Under the columns: why its buckets fall short of the headline figure. */
  note?: string
  /** In place of the change: why there is no sound comparison. */
  noCompare?: string
}

/** A store's slice of the period, for the linked highlight: its own figures and columns, shown while it is traced. */
export type OverviewStore = { stats: StoreStats; series: SeriesPoint[] }

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
 * each against the previous period and drawn per bucket (hours for Today, days otherwise). All VXP, and, when
 * `stores` is given, each store's own slice for the linked highlight.
 */
export function Overview({ total, series: points, period, nowHour, prevHoursComplete = true, stores, links }: {
  total: Portfolio['total']; series: SeriesPoint[]; period: Period; nowHour: number
  /** Yesterday's hourly spend adds up to its day (metrics.yesterdayHoursComplete): Today's spend comparison rests on it. */
  prevHoursComplete?: boolean
  stores?: OverviewStore[]
  /** Where each cell's arrow goes, and what it says it opens: for a traced store, that store's own link. */
  links?: (k: CardKey, store?: { id: string; name: string }) => { href: string; label: string }
}) {
  // Today's series holds only hours with activity: every hour from midnight to now keeps the chart in clock time.
  const fill = (s: SeriesPoint[]) => (period.id === 'today' ? everyHour(s, nowHour) : s)
  const series = fill(points)
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
      values: series.map((p) => p.revenue), kind: 'money', merge: 'sum', lit: true },
    { k: 'orders', label: 'Orders', source: 'Shopify', value: total.orders.toLocaleString('en-IN'), now: total.orders, prev: total.prevOrders,
      values: series.map((p) => p.orders), kind: 'count', merge: 'sum', lit: false },
    { k: 'aov', label: 'Avg order value', short: 'AOV', source: 'Shopify', value: aov === null ? '—' : inr(aov), now: aov, prev: prevAov,
      values: series.map((p) => p.revenue), den: series.map((p) => p.orders), kind: 'money', merge: 'ratio', lit: false },
    { k: 'spend', label: 'Ad spend', source: 'Meta', value: inr(total.spend), now: total.spend, prev: total.prevSpend, neutral: true,
      values: series.map((p) => p.spend), kind: 'money', merge: 'sum', lit: false, note: spendNote,
      noCompare: period.id === 'today' && !prevHoursComplete ? "no comparison: yesterday's hourly split incomplete" : undefined },
  ]
  const labels = series.map((p) => p.label)
  const vxp: Record<CardKey, number | null> = { rev: total.revenue, orders: total.orders, aov, spend: total.spend }

  return (
    <section aria-label={`Overview · ${period.range}`} className="space-y-2">
      {/* A custom range's dates in view: on a phone its pill can sit scrolled away, and "7D" alone reads as the last 7 days. */}
      {period.id === 'custom' && (
        <p className="label px-1">Custom range <span className="font-normal normal-case tracking-normal text-ink-2">· {period.range} · {period.short}</span></p>
      )}
      <div className="glass rise grid grid-cols-2 gap-2 p-2 sm:gap-2.5 sm:p-2.5 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.k} className="glass-row flex min-w-0 flex-col px-3.5 pb-3 pt-3 sm:px-4 sm:pt-3.5">
          <div className="flex items-start justify-between gap-2">
            {/* One line from sm up; on a phone's narrow card the source drops to a second line instead of being cut. */}
            <p className="label min-w-0 sm:truncate">
              <span className="block truncate sm:inline">
                {c.short ? <><span className="sm:hidden">{c.short}</span><span className="hidden sm:inline">{c.label}</span></> : c.label}
                <span className="font-normal normal-case tracking-normal text-ink-3"> · {period.short}</span>
              </span>
              <span className="block truncate font-normal normal-case tracking-normal text-ink-3 sm:inline"><span className="max-sm:hidden"> · </span>{c.source}</span>
            </p>
            {/* One arrow per variant, so a traced store's arrow opens that store. */}
            {links && (stores ? (
              <>
                <span data-hl-for="all" className="shrink-0"><Arrow {...links(c.k)} /></span>
                {stores.map(({ stats: s }) => <span key={s.store.id} data-hl-for={s.store.id} hidden className="shrink-0"><Arrow {...links(c.k, { id: s.store.id, name: s.store.name })} /></span>)}
              </>
            ) : <Arrow {...links(c.k)} />)}
          </div>

          <div data-hl-for={stores ? 'all' : undefined} className="mt-auto">
            <div className="mt-4 flex items-end justify-between gap-3 max-sm:flex-col max-sm:items-stretch">
              <div className="min-w-0">
                <p className="whitespace-nowrap text-[clamp(1.2rem,5.2vw,1.5rem)] font-semibold leading-none tracking-[-0.03em] tabular-nums sm:text-[1.75rem]">{c.value}</p>
                {/* The comparison wraps whole under the change on a narrow card, never word by word beside it. */}
                <div className="mt-2 flex min-h-[22px] flex-wrap items-center gap-x-1.5 text-xs text-ink-4">
                  {noPrev ? <span>no data for {period.prevLabel}</span>
                    : c.noCompare ? <span>{c.noCompare}</span>
                    : c.now === null || c.prev === null ? <span>no comparison: no orders {c.now === null ? 'this period' : period.prevLabel}</span>
                    : c.prev > 0 ? <><span className="inline-flex h-[22px] items-center rounded-md bg-white/6 px-1.5 [&>span]:text-xs"><Delta now={c.now} prev={c.prev} goodWhenUp={c.goodWhenUp ?? true} neutral={c.neutral} /></span><span>vs {period.prevLabel}</span></>
                    : <span>vs {c.kind === 'money' ? inr(0) : '0'} {period.prevLabel}</span>}
                </div>
              </div>
              <SquareBars values={c.values} den={c.den} labels={labels} kind={c.kind} merge={c.merge} lit={c.lit} name={c.label} />
            </div>
            {c.note && <p className="mt-1.5 text-xs text-warn">{c.note}</p>}
          </div>

          {stores?.map(({ stats: s, series: ss }) => {
            const own = fill(ss)
            const sAov = s.orders > 0 ? s.revenue / s.orders : null
            const fig: Record<CardKey, number | null> = { rev: s.revenue, orders: s.orders, aov: sAov, spend: s.spend }
            const vals: Record<CardKey, (number | null)[]> = { rev: own.map((p) => p.revenue), orders: own.map((p) => p.orders), aov: own.map((p) => p.revenue), spend: own.map((p) => p.spend) }
            const ownHourly = own.reduce((t, p) => t + p.spend, 0)
            const ownNote = c.k === 'spend' && period.id === 'today' && s.spend - ownHourly >= 1
              ? `Hourly split incomplete: ${inr(ownHourly)} of ${inr(s.spend)} by hour` : undefined
            const v = fig[c.k]
            const whole = vxp[c.k]
            const share = c.k !== 'aov' && v !== null && whole ? `${Math.round((v / whole) * 100)}% of VXP` : `VXP ${c.value}`
            const shown = v === null ? '—' : c.kind === 'count' ? v.toLocaleString('en-IN') : inr(v)
            return (
              <div key={s.store.id} data-hl-for={s.store.id} hidden className="mt-auto">
                <div className="mt-4 flex items-end justify-between gap-3 max-sm:flex-col max-sm:items-stretch">
                  <div className="min-w-0">
                    <p className="whitespace-nowrap text-[clamp(1.2rem,5.2vw,1.5rem)] font-semibold leading-none tracking-[-0.03em] tabular-nums sm:text-[1.75rem]">{shown}</p>
                    <p className="mt-2 flex min-h-[22px] items-center text-xs text-ink-3"><span className="font-semibold text-lime">{s.store.name}</span>&nbsp;· {share}</p>
                  </div>
                  <SquareBars values={vals[c.k]} labels={own.map((p) => p.label)} kind={c.kind} merge={c.merge} den={c.k === 'aov' ? own.map((p) => p.orders) : undefined} lit name={`${s.store.name} ${c.label}`} />
                </div>
                {ownNote && <p className="mt-1.5 text-xs text-warn">{ownNote}</p>}
              </div>
            )
          })}
        </div>
      ))}
      </div>
    </section>
  )
}

function Arrow({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} aria-label={label} title={label}
      className="-mr-1 -mt-0.5 inline-flex size-[26px] shrink-0 items-center justify-center rounded-full bg-lime text-on-lime transition-transform hover:scale-105">
      <ArrowUpRight className="size-3.5" strokeWidth={2.6} aria-hidden />
    </Link>
  )
}
