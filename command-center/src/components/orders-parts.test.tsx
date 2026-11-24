import { renderToStaticMarkup } from 'react-dom/server'
import type { OrderStats, OrderView } from '@/lib/orders'
import { describe, expect, it } from 'vitest'
import { OrdersPanel, OrdersVerdict, type MonthNav, type OrderFilters } from './OrdersParts'

// What the page builds for store=kaiven, month=2026-10, status=rto, pay=cod, q=OV12.
const filters: OrderFilters = {
  status: [
    { href: '/orders?store=kaiven&month=2026-10&pay=cod&q=OV12', label: 'All', on: false },
    { href: '/orders?store=kaiven&month=2026-10&status=rto&pay=cod&q=OV12', label: 'RTO', on: true },
  ],
  payment: [
    { href: '/orders?store=kaiven&month=2026-10&status=rto&q=OV12', label: 'All', on: false },
    { href: '/orders?store=kaiven&month=2026-10&status=rto&pay=cod&q=OV12', label: 'COD', on: true },
  ],
  hidden: { store: 'kaiven', month: '2026-10', status: 'rto', pay: 'cod' },
  q: 'OV12',
  clearHref: '/orders?store=kaiven&month=2026-10',
}
const html = renderToStaticMarkup(<OrdersPanel rows={[]} total={0} filters={filters} storeName={(id) => id} />)

describe('Orders panel filters', () => {
  it('pill hrefs keep the month, store and the other filter', () => {
    expect(html).toContain('href="/orders?store=kaiven&amp;month=2026-10&amp;pay=cod&amp;q=OV12"')
    expect(html).toContain('href="/orders?store=kaiven&amp;month=2026-10&amp;status=rto&amp;q=OV12"')
  })

  it('search form carries hidden inputs for the current filters, and the query as its value', () => {
    for (const [k, v] of Object.entries(filters.hidden)) {
      expect(html).toContain(`<input type="hidden" name="${k}" value="${v}"/>`)
    }
    expect(html).toMatch(/name="q"[^>]*value="OV12"|value="OV12"[^>]*name="q"/)
  })

  it('has no hidden inputs for filters that are not set', () => {
    const bare = renderToStaticMarkup(<OrdersPanel rows={[]} total={0} filters={{ ...filters, hidden: {}, q: '', clearHref: null }} storeName={(id) => id} />)
    expect(bare).not.toContain('type="hidden"')
  })
})

const nav: MonthNav = { prev: { long: 'September', short: 'Sep', href: '/orders?month=2026-09' }, current: { long: 'October', short: 'Oct' }, next: null }
const stats: OrderStats = { orders: 100, cancelled: 0, delivered: 10, rto: 0, inTransit: 90, notShipped: 0, rtoRate: 0, rtoShareOfAll: 0, bookedPaise: 0, rtoValuePaise: 0, rtoChargesPaise: 0 }

describe('Orders verdict', () => {
  it('says the delivery percentage is a share of resolved orders', () => {
    const v = renderToStaticMarkup(<OrdersVerdict s={{ ...stats, rto: 2, rtoRate: 0.2, rtoShareOfAll: 0.02 }} context="c" monthName="October" short="Oct" nav={nav} vf={{ stale: false, short: 'today', phrase: 'was last imported today' }} />)
    expect(v).toContain('80% of resolved delivered')
    expect(v).toContain('of all orders')
  })
})

describe('Orders compact row', () => {
  const o = {
    storeId: 'kaiven', orderName: '#OV1', date: '2026-10-05', status: 'rto', statusRaw: 'RTO In-Transit', closedOn: '2026-10-12', rtoChargesPaise: 9000,
    payment: 'prepaid', gateways: ['razorpay'], sku: 'KV-1', city: 'Pune', state: 'Maharashtra', totalPaise: 129900,
  } as unknown as OrderView
  const row = renderToStaticMarkup(<OrdersPanel rows={[o]} total={1} filters={filters} storeName={() => 'Kaiven'} />)

  it('shows the store name in the row and expands to the hidden fields with a native details', () => {
    expect(row).toContain('<details')
    expect(row).toContain('<summary')
    expect(row).toMatch(/<span[^>]*@min-\[50rem\]:hidden[^>]*>Kaiven<\/span>/)
    for (const label of ['Store', 'Payment', 'Product', 'Ship to', 'Status']) expect(row).toContain(`>${label}</dt>`)
    expect(row).toContain('Pune, Maharashtra')
    expect(row).toContain('KV-1')
    expect(row).toContain('RTO In-Transit')
  })
})
