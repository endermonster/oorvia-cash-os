import { describe, expect, it } from 'vitest'
import { forecastTicks, formatForecastTick, splitAtZero } from './ForecastChart'

describe('splitAtZero', () => {
  it('interpolates a crossing from loss to gain at the exact zero value', () => {
    expect(splitAtZero({ x: 10, value: -100 }, { x: 90, value: 300 })).toEqual({ x: 30, value: 0 })
  })

  it('interpolates a crossing from gain to loss', () => {
    expect(splitAtZero({ x: 10, value: 300 }, { x: 90, value: -100 })).toEqual({ x: 70, value: 0 })
  })

  it.each([[-100, -80], [100, 80], [-100, 0], [0, 100], [0, 0]])(
    'leaves the segment from %i to %i intact',
    (from, to) => expect(splitAtZero({ x: 10, value: from }, { x: 90, value: to })).toBeNull(),
  )
})

describe('forecast y-axis', () => {
  it('uses evenly spaced ticks that cover the data and include zero', () => {
    expect(forecastTicks([-13_010_000, 3_239_000])).toEqual([-15_000_000, -10_000_000, -5_000_000, 0, 5_000_000])
    expect(forecastTicks([-600])).toEqual([-600, -400, -200, 0, 200])
    expect(forecastTicks([0, 50])).toEqual([0, 100])
    expect(forecastTicks([0, 0])).toEqual([0])
  })

  it('keeps a labelled zero line with headroom when every value is a loss', () => {
    const ticks = forecastTicks([-100_000, -250_000, -300_000])
    expect(ticks).toContain(0)
    expect(ticks[ticks.length - 1]).toBeGreaterThan(0)
    expect(Object.is(ticks.find((t) => t === 0), -0)).toBe(false)
  })

  it.each([[0, '₹0'], [-500, '−₹5'], [2_500_000, '₹25k'], [-12_000_000, '−₹1.2L']])(
    'formats %i paise as %s',
    (paise, label) => expect(formatForecastTick(paise)).toBe(label),
  )
})
