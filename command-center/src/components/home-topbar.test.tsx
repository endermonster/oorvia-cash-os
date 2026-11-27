import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createMetrics } from '@/lib/metrics'
import { CASH, MOCK } from '@/lib/mock'
import type { ViewState } from '@/lib/nav'
import { codShareLabel, HomeView } from './Home'
import { TopBar } from './TopBar'

// The store and period switches navigate with the app router, which is not mounted in a static render.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))

describe('TopBar', () => {
  const view: ViewState = {
    store: 'oorvia',
    period: 'today',
    keep: { path: '/orders', params: { month: '2026-11' } },
  }

  it('marks the Settings gear current and keeps freshness chips without a tab', () => {
    const html = renderToStaticMarkup(<TopBar view={view} d={MOCK} />)
    expect(html).toMatch(/<a\b[^>]*aria-label="Settings"[^>]*aria-current="page"[^>]*href="\/settings\?store=oorvia&amp;period=today"/)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).not.toMatch(/aria-label="(?:Store|Period)"/)
    for (const source of ['Shopify', 'Meta', 'vFulfill']) expect(html).toContain(`>${source}</span>`)
  })

  it('keeps Orders filters on same-tab links when a tab is selected', () => {
    const html = renderToStaticMarkup(<TopBar tab="orders" view={view} d={MOCK} />)
    expect(html).toMatch(/<a\b[^>]*aria-current="page"[^>]*href="\/orders\?store=oorvia&amp;period=today&amp;month=2026-11"/)
    expect(html).toContain('href="/orders?period=today&amp;month=2026-11"')
    expect(html).not.toContain('href="/orders?store=oorvia&amp;month=2026-11"')
    expect(html).toContain('href="/money?store=oorvia&amp;period=today"')
    expect(html).toContain('href="/settings?store=oorvia&amp;period=today"')
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })

  it.each(['home', 'ads', 'orders', 'money'] as const)('shows the period rail only where it filters %s', (tab) => {
    const html = renderToStaticMarkup(<TopBar tab={tab} view={view} d={MOCK} />)
    expect(html).toContain('aria-label="Store"')
    expect(html.includes('aria-label="Period"')).toBe(tab === 'home' || tab === 'ads')
  })
})

describe('Home cash details', () => {
  it('separates spend coverage and missing cash sources with a middle dot', () => {
    const m = createMetrics(MOCK)
    const view: ViewState = { store: 'all', period: '7d' }
    const cash = () => ({
      ...CASH, settlements: null, settlementsTotal: 0, total: 12_000,
      included: ['bank', 'vFulfill wallet', 'COD due'], missing: ['gateway settlements'],
      dailySpend: 1_600, coversDays: 7.5,
    })
    const html = renderToStaticMarkup(<HomeView view={view} period={m.resolvePeriod(view.period)} m={{ ...m, cash }} now={MOCK.now} mock />)
    expect(html).toContain('covers 7 days of spend · without gateway settlements')
  })

  it('links GST and owner share to Money in the current view when figures are unavailable', () => {
    const m = createMetrics(MOCK)
    const view: ViewState = { store: 'all', period: '30d' }
    const html = renderToStaticMarkup(<HomeView view={view} period={m.resolvePeriod(view.period)} m={{ ...m, gst: () => null, ownerShare: () => null }} now={MOCK.now} mock />)
    expect(html).toMatch(/aria-label="GST on Money"[^>]*href="\/money\?period=30d"/)
    expect(html).toMatch(/aria-label="Partner share on Money"[^>]*href="\/money\?period=30d"/)
  })
})

describe('Home COD share', () => {
  it('excludes unknown payments from the denominator', () => {
    expect(codShareLabel({ orders: 100, codOrders: 10, unknownPayOrders: 80 })).toBe('50% COD')
  })

  it('omits the share when no payment is known', () => {
    expect(codShareLabel({ orders: 80, codOrders: 0, unknownPayOrders: 80 })).toBeUndefined()
    expect(codShareLabel({ orders: 0, codOrders: 0, unknownPayOrders: 0 })).toBeUndefined()
  })

  it('shows zero when all known payments are prepaid', () => {
    expect(codShareLabel({ orders: 10, codOrders: 0, unknownPayOrders: 0 })).toBe('0% COD')
  })
})
