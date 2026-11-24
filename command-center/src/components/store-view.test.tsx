import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMetrics, type StoreStats } from '@/lib/metrics'
import { MOCK } from '@/lib/mock'
import type { ViewState } from '@/lib/nav'
import { StoreView } from './StoreView'

const view: ViewState = { store: 'oorvia', period: '7d' }

function render(patch: Partial<StoreStats>) {
  const m = createMetrics(MOCK)
  const period = m.resolvePeriod(view.period)
  const storeStats: typeof m.storeStats = (id, p) => ({ ...m.storeStats(id, p), ...patch })
  return renderToStaticMarkup(<StoreView id="oorvia" view={view} period={period} m={{ ...m, storeStats }} orders={[]} />)
}

describe('StoreView', () => {
  it('COD share excludes unknown payments and drops the % when none are known', () => {
    expect(render({ orders: 100, codOrders: 10, unknownPayOrders: 80 })).toContain('50% COD')
    expect(render({ orders: 80, codOrders: 0, unknownPayOrders: 80 })).not.toMatch(/\d% COD<\/span>/)
  })

  it('puts profit-affecting warnings first and reveals the rest in a details disclosure', () => {
    const html = render({ ordersMissingCogs: 2, unmappedSpend: 500, unknownSkus: ['AA1', 'BB2', 'CC3'] })
    expect(html).toContain('<details')
    expect(html).toContain('<summary')
    expect(html).toContain('+2 more')
    const first = html.indexOf('profit is overstated')
    expect(first).toBeGreaterThan(-1)
    expect(first).toBeLessThan(html.indexOf('matches no product, check the handle'))
    expect(html.indexOf('matches no product, check the handle')).toBeLessThan(html.indexOf('SKU AA1'))
    expect(html.indexOf('<details')).toBeLessThan(html.indexOf('SKU CC3'))
  })

  it('shows each product its own COD share, beside its delivery rates', () => {
    const m = createMetrics(MOCK)
    const period = m.resolvePeriod(view.period)
    const html = (n: number) => {
      const [one] = m.relevantProducts('oorvia', period)
      const products = [one, { ...one, sku: 'OMS-2M', name: 'Second product' }]
      const relevantProducts: typeof m.relevantProducts = () => products.slice(0, n)
      return renderToStaticMarkup(<StoreView id="oorvia" view={view} period={period} m={{ ...m, relevantProducts }} orders={[]} />)
    }
    for (const n of [0, 1, 2]) expect(html(n).match(/>COD share/g) ?? []).toHaveLength(n)
  })

  it('keeps breakeven and target visible when no ads ran', () => {
    const html = render({ roas: null, zone: null, spend: 0 })
    expect(html).toMatch(/Breakeven [\d.]+× · target [\d.]+×/)
    expect(html).toContain('No ads ran in this period.')
  })
})
