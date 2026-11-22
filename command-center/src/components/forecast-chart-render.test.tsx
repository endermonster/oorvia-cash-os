import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Forecast } from '@/lib/forecast'
import { ForecastChart } from './ForecastChart'

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  // Supply the measured width during static rendering, where ResizeObserver does not run.
  return { ...react, useState: (initial: unknown) => react.useState(initial === 0 ? 484 : initial) }
})

const forecast: Forecast = {
  opening: { netPaise: -100, periodEnd: null, note: null },
  rows: [
    { month: '2026-10', net: 200, cumulative: 100, partial: false },
    { month: '2026-11', net: 0, cumulative: 100, partial: true },
  ],
  cumulative: 100,
  average: 200,
  finishedMonths: 1,
  needed: [],
  breakEven: null,
}

describe('ForecastChart rendering', () => {
  it('joins the red and green segments at zero and marks the partial month', () => {
    const html = renderToStaticMarkup(<ForecastChart forecast={forecast} />)
    expect(html).toMatch(/d="M68,168L168,96" style="fill:none;stroke:var\(--color-bad\)"/)
    expect(html).toMatch(/d="M168,96L268,24" style="fill:none;stroke:var\(--color-good\)"/)
    expect(html).toMatch(/Nov<tspan[^>]*>so far<\/tspan>/)
    expect(html).not.toContain('Break-even')
    expect(html).not.toContain('stroke-dasharray')
  })

  it('labels a distant projection and limits it to 40% of the plot', () => {
    const html = renderToStaticMarkup(<ForecastChart forecast={{
      ...forecast,
      opening: { ...forecast.opening, netPaise: -12_100 },
      rows: [
        { ...forecast.rows[0], net: 100, cumulative: -12_000 },
        { ...forecast.rows[1], cumulative: -12_000 },
      ],
      cumulative: -12_000,
      average: 100,
      breakEven: '2036-11',
    }} />)
    expect(html).toMatch(/<line x1="308" x2="468"[^>]*stroke-dasharray="5 4"/)
    expect(html).toContain('Projection time scale compressed')
    expect(html).toContain('Break-even · November 2036')
  })
})
