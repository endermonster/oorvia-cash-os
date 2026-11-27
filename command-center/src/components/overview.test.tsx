import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMetrics, type Portfolio, type SeriesPoint } from '@/lib/metrics'
import { MOCK } from '@/lib/mock'
import { Overview } from './Overview'
import { Sparkline } from './Sparkline'

const m = createMetrics(MOCK)
const period = m.resolvePeriod('30d')
const base = m.portfolio(period).total
const point = (orders: number, revenue: number): SeriesPoint => ({
  key: '2026-11-01', label: '1 Nov', revenue, orders, spend: 100, profit: 0, cumRevenue: revenue, cumSpend: 100, cumProfit: 0, prevCumRevenue: null,
})
const render = (total: Partial<Portfolio['total']>, pts = [point(2, 3000)], p = period, nowHour = 12) =>
  renderToStaticMarkup(<Overview total={{ ...base, ...total }} series={pts} period={p} nowHour={nowHour} />)

describe('Overview cards', () => {
  it('says "no data" when the comparison window holds nothing, rather than comparing with ₹0', () => {
    const html = render({ prevOrders: 0, prevRevenue: 0, prevSpend: 0 })
    expect(html).toContain('no data for previous 30 days')
    expect(html).not.toContain('vs ₹0')
  })

  it('gives AOV no change when either period has no orders: an average over nothing has no value', () => {
    expect(render({ orders: 0, revenue: 0 })).toContain('no comparison: no orders this period')
    expect(render({ prevOrders: 0, prevRevenue: 0, prevSpend: 500 })).toContain('no comparison: no orders previous 30 days')
    const aovCard = render({ orders: 0, revenue: 0 }).split('Avg order value')[1].split('Ad spend')[0]
    expect(aovCard).not.toContain('%')
  })

  it('keeps the period and the source on every card, phone included (the source on a second line there)', () => {
    const html = render({})
    expect(html.match(/ · 30D</g)?.length).toBe(4)
    expect(html.match(/<span class="max-sm:hidden"> · <\/span>(Shopify|Meta)</g)?.length).toBe(4)
    expect(html).not.toContain('hidden sm:inline"> · Shopify')
  })

  it("draws Today's cards over every hour from midnight to now, quiet hours included", () => {
    const today = m.resolvePeriod('today')
    const at = (hour: number, orders: number): SeriesPoint => ({ ...point(orders, orders * 1000), key: String(hour), label: `${hour}h` })
    const html = render({}, [at(9, 1), at(17, 2)], today, 18)
    expect(html).toContain('aria-valuemax="18"') // 0 … 18: 19 buckets, not 2
    expect(html).toContain('aria-valuetext="6 pm: 0"') // the newest hour, quiet, as zero orders
  })

  it("says when Today's hourly spend falls short of the day's total, and stays quiet when it adds up", () => {
    const today = m.resolvePeriod('today')
    const at = (hour: number, spend: number): SeriesPoint => ({ ...point(1, 1000), key: String(hour), spend })
    expect(render({ spend: 50 }, [at(9, 30)], today, 12)).toContain('Hourly split incomplete: ₹30 of ₹50 by hour')
    expect(render({ spend: 30 }, [at(9, 30)], today, 12)).not.toContain('Hourly split incomplete')
    expect(render({ spend: 50 }, [at(9, 30)])).not.toContain('Hourly split incomplete') // days, not hours
  })

  it("gives Today's spend no change when yesterday's hours fall short of its day, on that card only", () => {
    const today = m.resolvePeriod('today')
    const html = renderToStaticMarkup(<Overview total={{ ...base, spend: 500, prevSpend: 200 }} series={[point(2, 3000)]} period={today} nowHour={12} prevHoursComplete={false} />)
    const spendCard = html.split('Ad spend')[1]
    expect(spendCard).toContain("no comparison: yesterday&#x27;s hourly split incomplete")
    expect(spendCard).not.toContain('%')
    expect(html.split('Ad spend')[0]).not.toContain('hourly split incomplete')
    // Other periods compare daily totals: the flag does not apply.
    expect(renderToStaticMarkup(<Overview total={base} series={[point(2, 3000)]} period={period} nowHour={12} prevHoursComplete={false} />)).not.toContain('hourly split incomplete')
  })

  it('names a custom range by its dates, not only its length', () => {
    const custom = createMetrics({ ...MOCK, today: '2026-11-27' }).resolvePeriod('custom', { from: '2026-09-01', to: '2026-09-07' })
    const html = render({}, [point(2, 3000)], custom)
    expect(html).toContain('Custom range')
    expect(html).toContain(custom.range)
    expect(render({})).not.toContain('Custom range')
  })
})

describe('Sparkline', () => {
  it('is a keyboard slider whose value text names the bucket and its value', () => {
    const html = renderToStaticMarkup(<Sparkline values={[10, null, 30]} labels={['1 Nov', '2 Nov', '3 Nov']} kind="money" stroke="" fill="" dot="" name="Revenue" />)
    expect(html).toContain('role="slider"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-valuetext="3 Nov: ₹30"')
  })
})
