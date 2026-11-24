import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMetrics } from '@/lib/metrics'
import { MOCK } from '@/lib/mock'
import { filterOrders, type OrderView } from '@/lib/orders'
import type { SyncStatus } from '@/lib/types'
import { rateSourceNote, vfState } from './bits'
import { CashCard } from './CashCard'
import { verdict } from './Home'
import { OrdersPanel, type OrderFilters } from './OrdersParts'

const name = (id: string) => id.charAt(0).toUpperCase() + id.slice(1)
const sync = (over: Partial<SyncStatus>): SyncStatus =>
  ({ ...MOCK.sync, vfulfillImportDaysAgo: 1, vfulfillDataDaysAgo: null, shipmentsThrough: '2026-11-20', vfulfillMissingStores: [], vfulfillOverdueOrders: null, vfulfillOpenShipments: null, ...over })

describe('vfState', () => {
  it('nothing overdue and nothing open reads current, however old the import', () => {
    expect(vfState(sync({ vfulfillImportDaysAgo: 40, vfulfillOverdueOrders: 0, vfulfillOpenShipments: 0 }), name, 2)).toMatchObject({ stale: false, short: 'up to date' })
  })
  it('an open shipment keeps an old import stale: it may have closed since', () => {
    expect(vfState(sync({ vfulfillImportDaysAgo: 40, vfulfillOverdueOrders: 0, vfulfillOpenShipments: 2 }), name, 2).stale).toBe(true)
  })
  it('names a store left out of the export', () => {
    expect(vfState(sync({ vfulfillMissingStores: ['kaiven'] }), name, 2)).toMatchObject({ stale: true, short: 'Kaiven missing' })
  })
  it('old data under a fresh import is stale, dated to the newest shipment', () => {
    const s = vfState(sync({ vfulfillImportDaysAgo: 0, vfulfillDataDaysAgo: 83, shipmentsThrough: '2026-09-02', vfulfillOverdueOrders: 6 }), name, 3)
    expect(s).toMatchObject({ stale: true, short: '83 days old', phrase: 'runs only to 2 Sept' })
  })
  it('an old import is stale; a recent one is not; none at all is', () => {
    expect(vfState(sync({ vfulfillImportDaysAgo: 5 }), name, 2).stale).toBe(true)
    expect(vfState(sync({ vfulfillImportDaysAgo: 2 }), name, 2)).toMatchObject({ stale: false, short: '2 days old' })
    expect(vfState(sync({ vfulfillImportDaysAgo: null }), name, 2)).toMatchObject({ stale: true, short: 'never imported' })
  })
})

describe('rateSourceNote', () => {
  const st = (n: string) => ({ name: n })
  it('one line when every store uses its own last 30 days', () => {
    expect(rateSourceNote([{ store: st('Oorvia'), source: 'own-30d' }, { store: st('Kaiven'), source: 'own-30d' }])).toBe('Delivery rates: each store’s last 30 days')
  })
  it('per store otherwise', () => {
    expect(rateSourceNote([{ store: st('Oorvia'), source: 'own-lifetime' }, { store: st('Kaiven'), source: 'vxp' }]))
      .toBe('Delivery rates: Oorvia all-time · Kaiven VXP average')
    expect(rateSourceNote([])).toBeNull()
  })
})

describe('verdict with stopped ads', () => {
  const stores = createMetrics(MOCK).portfolio(createMetrics(MOCK).resolvePeriod('7d')).stores
    .map((s) => ({ ...s, spend: 100, contribution: 500, ordersMissingCogs: 0 }))
  it('a store whose ads Meta stopped leads, and is not "paying for itself"', () => {
    const v = verdict(stores, () => false, ['kaiven'])
    expect(v).toMatch(/^Kaiven’s ads stopped\. /)
    expect(v).toBe('Kaiven’s ads stopped. Oorvia and Selnova are paying for themselves.')
  })
  it('unchanged without a stop', () => {
    expect(verdict(stores, () => false)).toMatch(/paying for themselves\.$/)
  })
})

describe('Orders row status', () => {
  const filters: OrderFilters = { status: [], payment: [], hidden: {}, q: '', clearHref: '/orders' }
  const row = (noShipmentData: boolean): OrderView => ({
    storeId: 'oorvia', orderName: '#OV1', placedAt: '2026-11-19T10:00:00+05:30', payment: 'cod', gateways: [], totalPaise: 249_900,
    sku: 'OMS-1M', city: 'Pune', state: 'Maharashtra', cancelledAt: null,
    date: '2026-11-19', status: 'not_shipped', noShipmentData, statusRaw: null, closedOn: null, rtoChargesPaise: 0,
  })
  const html = (r: OrderView) => renderToStaticMarkup(<OrdersPanel rows={[r]} total={1} filters={filters} storeName={name} />)
  it('says "No shipment data" when the data does not cover the order, "Not shipped" otherwise', () => {
    expect(html(row(true))).toContain('No shipment data')
    expect(html(row(false))).toContain('Not shipped')
    expect(html(row(false))).not.toContain('No shipment data')
  })
})

describe('Orders status filter', () => {
  const base = { storeId: 'oorvia', placedAt: '2026-11-19T10:00:00+05:30', payment: 'cod' as const, gateways: [], totalPaise: 1, sku: null, city: null, state: null, cancelledAt: null, date: '2026-11-19', statusRaw: null, closedOn: null, rtoChargesPaise: 0 }
  const rows: OrderView[] = [
    { ...base, orderName: '#A', status: 'not_shipped', noShipmentData: true },
    { ...base, orderName: '#B', status: 'not_shipped', noShipmentData: false },
  ]
  it('"Not shipped" leaves out orders the data does not reach; "No shipment data" picks only those', () => {
    expect(filterOrders(rows, { status: 'not_shipped', payment: null, q: '' }).map((o) => o.orderName)).toEqual(['#B'])
    expect(filterOrders(rows, { status: 'no_data', payment: null, q: '' }).map((o) => o.orderName)).toEqual(['#A'])
    expect(filterOrders(rows, { status: null, payment: null, q: '' })).toHaveLength(2)
  })
})

describe('Cash COD note', () => {
  const stale = { stale: true, short: '83 days old', phrase: 'runs only to 2 Sept' }
  const cash = createMetrics({ ...MOCK, cash: { ...MOCK.cash!, codDue: 2798, codDueOrders: 2 } }).cash()
  it('keeps the stale caveat when COD is due', () => {
    const html = renderToStaticMarkup(<CashCard c={cash} vf={stale} />)
    expect(html).toContain('2 delivered COD orders not remitted yet · the shipments data runs only to 2 Sept')
  })
})
