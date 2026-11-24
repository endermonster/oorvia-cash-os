import { describe, expect, it } from 'vitest'
import { istNow } from './dates'
import {
  currentCogs, mapCampaign, mapCash, mapCampaignDay, mapCampaignHour, mapOrderDay, mapOrderHour, mapProduct, mapRecentOrder, mapResolvedDay, mapStore,
  mapSync, metaStoresAmong, shipmentCutoffs, sortStores,
} from './load'
import type { Product } from './types'

// Fixtures are hand-written PostgREST rows: numeric columns as strings where Postgres numeric comes back that way.

const product: Product = {
  sku: 'KV-DHS', storeId: 'kaiven', name: 'Scalp Serum', price: 1499, cogs: 300, packedWeightGrams: 500, liveSince: '2026-11-10',
  handle: 'deoxyribose-scalp-serum', stage: 'testing',
}

describe('mapStore', () => {
  it('maps names and coerces the gateway fee', () => {
    expect(mapStore({ id: 'kaiven', name: 'Kaiven', live_since: '2026-11-10', gateways: ['Razorpay', 'PayU'], gateway_pct: '0.0200' })).toEqual({
      id: 'kaiven', name: 'Kaiven', liveSince: '2026-11-10', gateways: ['Razorpay', 'PayU'], gatewayPct: 0.02,
    })
  })
})

describe('currentCogs and mapProduct', () => {
  const rows = [
    { store_id: 'kaiven', sku: 'KV-DHS', cogs_paise: 30000, effective_from: '2026-01-01' },
    { store_id: 'kaiven', sku: 'KV-DHS', cogs_paise: '40050', effective_from: '2026-11-15' },
    { store_id: 'kaiven', sku: 'KV-DHS', cogs_paise: 99900, effective_from: '2026-12-01' },
    { store_id: 'selnova', sku: 'KV-DHS', cogs_paise: 11100, effective_from: '2026-01-01' },
  ]

  it('takes the latest entry on or before today, per store and SKU, in rupees', () => {
    const c = currentCogs(rows, '2026-11-18')
    expect(c.get('kaiven:KV-DHS')).toBe(400.5)
    expect(c.get('selnova:KV-DHS')).toBe(111)
    expect(currentCogs(rows, '2026-11-14').get('kaiven:KV-DHS')).toBe(300)
    expect(currentCogs(rows, '2026-11-15').get('kaiven:KV-DHS')).toBe(400.5)
  })

  it('converts paise to rupees and attaches the current cost', () => {
    const p = mapProduct(
      { store_id: 'kaiven', sku: 'KV-DHS', name: 'Scalp Serum', price_paise: '149900', packed_weight_grams: '500', handle: 'deoxyribose-scalp-serum', stage: 'testing', live_since: '2026-11-10' },
      currentCogs(rows, '2026-11-18'),
    )
    expect(p).toEqual({ ...product, cogs: 400.5 })
  })

  it('gives a product with no cost on record null, never 0, and does not throw', () => {
    const p = mapProduct({ store_id: 'oorvia', sku: 'X', name: 'X', price_paise: 100, packed_weight_grams: 1, handle: 'x', stage: 'live', live_since: null }, new Map())
    expect(p.cogs).toBeNull()
    expect(p.liveSince).toBe('')
  })
})

const orderAmounts = { store_id: 'kaiven', sku: 'KV-DHS', payment: 'cod', orders: '2', units: '3', revenue: '4497.50', cogs: '900', slabs500: '3', slabs_kg: '2' }
const dayExpected = { storeId: 'kaiven', sku: 'KV-DHS', payment: 'cod', orders: 2, units: 3, revenue: 4497.5, cogs: 900, slabs500: 3, slabsKg: 2 }

describe('order rows', () => {
  it('mapOrderDay renames slabs_kg and coerces numbers', () => {
    expect(mapOrderDay({ date: '2026-11-17', ...orderAmounts })).toEqual({ date: '2026-11-17', ...dayExpected, ordersMissingCogs: 0 })
  })

  it('mapOrderDay reads orders_missing_cogs', () => {
    expect(mapOrderDay({ date: '2026-11-17', ...orderAmounts, orders_missing_cogs: '2' }).ordersMissingCogs).toBe(2)
  })

  it('mapOrderHour carries the hour as a number and no date', () => {
    const h = mapOrderHour({ date: '2026-11-17', hour: '14', ...orderAmounts })
    expect(h).toEqual({ hour: 14, ...dayExpected })
    expect('date' in h).toBe(false)
  })
})

describe('mapResolvedDay', () => {
  it('renames closed_on and coerces counts', () => {
    expect(mapResolvedDay({ closed_on: '2026-11-17', store_id: 'oorvia', sku: 'OMS-1M', payment: 'prepaid', delivered: '5', rto: 1 })).toEqual({
      closedOn: '2026-11-17', storeId: 'oorvia', sku: 'OMS-1M', payment: 'prepaid', delivered: 5, rto: 1,
    })
  })
})

const campRow = { store_id: 'kaiven', campaign_id: '1200', sku: 'KV-DHS', spend: '1234.5', impressions: '10000', clicks: '210', meta_purchases: '3', attributed_orders: '2' }
const campExpected = { storeId: 'kaiven', campaignId: '1200', sku: 'KV-DHS', spend: 1234.5, impressions: 10000, clicks: 210, metaPurchases: 3, attributedOrders: 2 }

describe('campaign rows', () => {
  it('mapCampaignDay maps every field to the contract names', () => {
    expect(mapCampaignDay({ date: '2026-11-17', ...campRow })).toEqual({ date: '2026-11-17', ...campExpected })
  })

  it('keeps a null SKU null (handle matched no product)', () => {
    expect(mapCampaignDay({ date: '2026-11-17', ...campRow, sku: null }).sku).toBeNull()
  })

  it('mapCampaignHour carries the hour and no date', () => {
    const h = mapCampaignHour({ date: '2026-11-17', hour: '9', ...campRow })
    expect(h).toEqual({ hour: 9, ...campExpected })
    expect('date' in h).toBe(false)
  })
})

describe('mapCampaign', () => {
  it('resolves the SKU from the landing handle within the same store and keeps the Meta status', () => {
    expect(mapCampaign({ campaign_id: 'C1', store_id: 'kaiven', name: 'Broad', landing_handle: 'deoxyribose-scalp-serum', status: 'PAUSED' }, [product])).toEqual({
      id: 'C1', storeId: 'kaiven', sku: 'KV-DHS', name: 'Broad', status: 'PAUSED',
    })
  })

  it('gives a null SKU when the handle is unknown, missing, or belongs to another store', () => {
    const base = { campaign_id: 'C1', store_id: 'kaiven', name: 'Broad', status: null }
    expect(mapCampaign({ ...base, landing_handle: 'nope' }, [product]).sku).toBeNull()
    expect(mapCampaign({ ...base, landing_handle: null }, [product]).sku).toBeNull()
    expect(mapCampaign({ ...base, store_id: 'selnova', landing_handle: 'deoxyribose-scalp-serum' }, [product]).sku).toBeNull()
  })

  it('keeps a missing Meta status null', () => {
    expect(mapCampaign({ campaign_id: 'C1', store_id: 'kaiven', name: 'Broad', landing_handle: null, status: null }, [product]).status).toBeNull()
  })
})

describe('mapRecentOrder', () => {
  const row = { store_id: 'kaiven', order_name: '#KAI1001', placed_at: '2026-11-17T14:30:00+00:00', payment: 'prepaid', total_paise: '139900', primary_sku: 'KV-DHS', city: 'Pune' }

  it('converts paise to rupees, looks up the product name and normalises the timestamp', () => {
    expect(mapRecentOrder(row, [product])).toEqual({
      id: 'kaiven:#KAI1001', storeId: 'kaiven', placedAt: '2026-11-17T14:30:00.000Z', sku: 'KV-DHS', product: 'Scalp Serum', value: 1399, payment: 'prepaid', city: 'Pune',
    })
  })

  it('shows a dash for a missing city and falls back to the SKU for an unknown product', () => {
    const o = mapRecentOrder({ ...row, city: null, primary_sku: 'GONE' }, [product])
    expect(o.city).toBe('—')
    expect(o.product).toBe('GONE')
  })
})

describe('mapSync', () => {
  const now = new Date('2026-11-18T10:00:00Z')
  const run = (source: string, finished_at: string, store_id: string | null = 'kaiven', ok = true) => ({ source, store_id, finished_at, ok })
  const stores = ['kaiven', 'selnova']

  it('uses the latest successful run per source', () => {
    const s = mapSync([
      run('meta', '2026-11-18T09:56:00Z'), run('meta', '2026-11-18T09:00:00Z'), run('meta', '2026-11-18T09:57:00Z', 'selnova'),
      run('shopify_webhook', '2026-11-18T09:59:00Z'), run('shopify_webhook', '2026-11-18T09:59:50Z', 'kaiven', false),
      run('shopify_webhook', '2026-11-18T09:58:00Z', 'selnova'),
      run('vf_shipments', '2026-11-14T09:00:00Z'), run('vf_shipments', '2026-11-14T09:00:00Z', 'selnova'),
    ], stores, now)
    expect(s).toEqual({
      metaMinutesAgo: 4, metaMinutesAgoByStore: { kaiven: 4, selnova: 3 }, metaYesterdayVerified: { kaiven: false, selnova: false }, metaNotConnected: [], shopifyMinutesAgo: 2, vfulfillImportDaysAgo: 4, shipmentsThrough: null, vfulfillDataDaysAgo: null, vfulfillMissingStores: [], vfulfillOverdueOrders: null,
    })
  })

  it('counts either shopify_webhook or shopify_backfill as Shopify freshness', () => {
    const s = mapSync([
      run('shopify_webhook', '2026-11-18T08:00:00Z'), run('shopify_backfill', '2026-11-18T09:30:00Z'),
      run('shopify_webhook', '2026-11-18T09:40:00Z', 'selnova'),
    ], stores, now)
    expect(s.shopifyMinutesAgo).toBe(30) // kaiven 30 min (backfill), selnova 20 min: the oldest of the two stores
  })

  it('ignores shopify_products and vf_transactions', () => {
    const s = mapSync([
      run('shopify_products', '2026-11-18T09:59:00Z'), run('shopify_products', '2026-11-18T09:59:00Z', 'selnova'),
      run('vf_transactions', '2026-11-18T09:59:00Z'), run('vf_transactions', '2026-11-18T09:59:00Z', 'selnova'),
    ], stores, now)
    expect(s).toEqual({
      metaMinutesAgo: null, metaMinutesAgoByStore: {}, metaYesterdayVerified: {}, metaNotConnected: ['kaiven', 'selnova'], shopifyMinutesAgo: null, vfulfillImportDaysAgo: null,
      shipmentsThrough: null, vfulfillDataDaysAgo: null, vfulfillMissingStores: [], vfulfillOverdueOrders: null,
    })
  })

  it('one stale store makes the whole source stale', () => {
    const s = mapSync([
      run('shopify_webhook', '2026-11-18T09:59:00Z'), run('shopify_webhook', '2026-11-18T07:00:00Z', 'selnova'),
    ], stores, now)
    expect(s.shopifyMinutesAgo).toBe(180)
  })

  it('one never-synced store makes the whole source never synced', () => {
    expect(mapSync([run('vf_shipments', '2026-11-18T09:59:00Z')], stores, now).vfulfillImportDaysAgo).toBeNull()
  })

  it('a run with no store counts for every store', () => {
    const s = mapSync([run('vf_shipments', '2026-11-16T09:00:00Z', null)], stores, now)
    expect(s.vfulfillImportDaysAgo).toBe(2)
  })

  it('ages shipments data independently of the import run', () => {
    const s = mapSync([run('vf_shipments', '2026-11-18T09:00:00Z', null)], stores, now, stores, '2026-11-14')
    expect(s).toMatchObject({ vfulfillImportDaysAgo: 0, shipmentsThrough: '2026-11-14', vfulfillDataDaysAgo: 4 })
  })

  it.each([
    ['2026-11-18T18:29:59Z', '2026-11-18', 0],
    ['2026-11-18T18:30:00Z', '2026-11-18', 1],
    ['2026-11-18T18:30:00Z', '2026-11-19', 0],
    ['2026-11-18T18:30:00Z', '2026-11-20', 0],
  ])('uses IST calendar days and clamps future dates (%s, %s)', (timestamp, shipmentsThrough, age) => {
    expect(mapSync([], stores, new Date(timestamp), stores, shipmentsThrough)).toMatchObject({ shipmentsThrough, vfulfillDataDaysAgo: age })
  })

  it('ages a store left out of the newest import from its own last import, when that is worse', () => {
    const s = mapSync([], stores, now, stores, '2026-11-17', [{ storeId: 'kaiven', seenAt: '2026-11-10T06:00:00Z' }])
    expect(s).toMatchObject({ shipmentsThrough: '2026-11-17', vfulfillDataDaysAgo: 8, vfulfillMissingStores: ['kaiven'] })
    expect(mapSync([], stores, now, stores, '2026-11-01', [{ storeId: 'kaiven', seenAt: '2026-11-10T06:00:00Z' }]).vfulfillDataDaysAgo).toBe(17)
  })

  it("reads yesterday_verified from each store's latest ok Meta run; old or unreadable detail is unverified", () => {
    const s = mapSync([
      { ...run('meta', '2026-11-18T09:00:00Z'), detail: JSON.stringify({ yesterday_verified: false }) },
      { ...run('meta', '2026-11-18T09:50:00Z'), detail: JSON.stringify({ yesterday_verified: true }) },
      { ...run('meta', '2026-11-18T09:55:00Z', 'kaiven', false), detail: JSON.stringify({ yesterday_verified: false }) },
      { ...run('meta', '2026-11-18T09:50:00Z', 'selnova'), detail: 'not json' },
    ], stores, now)
    expect(s.metaYesterdayVerified).toEqual({ kaiven: true, selnova: false })
  })

  it('does not age an old newest shipment when no order is waiting on vFulfill; a missing store still ages', () => {
    expect(mapSync([], stores, now, stores, '2026-09-02', [], 0)).toMatchObject({ vfulfillDataDaysAgo: null, vfulfillOverdueOrders: 0 })
    expect(mapSync([], stores, now, stores, '2026-09-02', [], 6).vfulfillDataDaysAgo).toBe(77)
    expect(mapSync([], stores, now, stores, '2026-09-02', [{ storeId: 'kaiven', seenAt: '2026-11-10T06:00:00Z' }], 0).vfulfillDataDaysAgo).toBe(8)
  })

  it('ignores failed runs', () => {
    expect(mapSync([run('meta', '2026-11-18T09:59:00Z', 'kaiven', false)], ['kaiven'], now).metaMinutesAgo).toBeNull()
  })

  it('expects Meta only from stores that have an ad account', () => {
    const s = mapSync([run('meta', '2026-11-18T09:50:00Z')], stores, now, ['kaiven'])
    expect(s.metaMinutesAgo).toBe(10)
  })

  it('skips a never-synced Meta store: the other store sets the age, and the skipped one is listed', () => {
    const s = mapSync([run('meta', '2026-11-18T09:50:00Z', 'kaiven')], stores, now)
    expect(s.metaMinutesAgo).toBe(10)
    expect(s.metaNotConnected).toEqual(['selnova'])
  })

  it('is null with every Meta store listed when none has ever synced', () => {
    const s = mapSync([], stores, now)
    expect(s.metaMinutesAgo).toBeNull()
    expect(s.metaNotConnected).toEqual(['kaiven', 'selnova'])
  })

  it('keeps a store that synced once and lost access: its last ok time goes stale, it is not "not connected"', () => {
    const s = mapSync([run('meta', '2026-11-18T08:00:00Z', 'kaiven'), run('meta', '2026-11-18T09:59:00Z', 'selnova')], stores, now)
    expect(s.metaMinutesAgo).toBe(120)
    expect(s.metaNotConnected).toEqual([])
  })

  it('reports null for every source when nothing ever ran', () => {
    expect(mapSync([], stores, now)).toEqual({
      metaMinutesAgo: null, metaMinutesAgoByStore: {}, metaYesterdayVerified: {}, metaNotConnected: ['kaiven', 'selnova'], shopifyMinutesAgo: null, vfulfillImportDaysAgo: null,
      shipmentsThrough: null, vfulfillDataDaysAgo: null, vfulfillMissingStores: [], vfulfillOverdueOrders: null,
    })
  })
})

describe('shipmentCutoffs', () => {
  it("is the earlier of the newest closed shipment and the store's own last import (IST day); no rows = absent", () => {
    expect(shipmentCutoffs({
      through: '2026-11-20',
      seenByStore: { oorvia: '2026-11-21T05:00:00Z', kaiven: '2026-11-10T18:45:00Z' }, // kaiven: 11 Nov 00:15 IST
    })).toEqual({ oorvia: '2026-11-20', kaiven: '2026-11-11' })
    expect(shipmentCutoffs({ through: null, seenByStore: { oorvia: '2026-11-21T05:00:00Z' } })).toEqual({})
  })
})

describe('metaStoresAmong', () => {
  it('comes from the ad account allowlist, not from the stores table', () => {
    expect(metaStoresAmong(['oorvia', 'kaiven', 'selnova'])).toEqual(['kaiven', 'oorvia', 'selnova'])
  })
  it('leaves out a store with no allowlisted account', () => {
    expect(metaStoresAmong(['oorvia', 'newstore'])).toEqual(['oorvia'])
  })
})

describe('sortStores', () => {
  it('orders by live_since, then name', () => {
    const st = (name: string, liveSince: string) => ({ id: name.toLowerCase() as 'oorvia', name, liveSince, gateways: [], gatewayPct: 0.02 })
    expect(sortStores([st('Selnova', '2026-11-13'), st('Kaiven', '2026-11-10'), st('Oorvia', '2026-03-21'), st('Aaa', '2026-11-10')]).map((x) => x.name))
      .toEqual(['Oorvia', 'Aaa', 'Kaiven', 'Selnova'])
  })
})

describe('istNow', () => {
  it('reads the date and hour in India, across the UTC date line', () => {
    expect(istNow(new Date('2026-11-18T09:50:00Z'))).toEqual({ today: '2026-11-18', hour: 15, minute: 20 })
    expect(istNow(new Date('2026-11-17T20:00:00Z'))).toEqual({ today: '2026-11-18', hour: 1, minute: 30 })
    expect(istNow(new Date('2026-11-18T18:29:00Z'))).toEqual({ today: '2026-11-18', hour: 23, minute: 59 })
  })
})

describe('mapCash', () => {
  const now = new Date('2026-11-19T10:00:00Z')
  const wallet = { balance: '190545.1746', last_txn_date: '2026-11-19', transactions: '3333' }

  it('wallet rounded once to the paisa, COD due summed over stores, bank from the latest entry', () => {
    expect(mapCash(wallet, [{ store_id: 'oorvia', orders: '2', paise: '279800' }, { store_id: 'kaiven', orders: 1, paise: 149900 }], { amount_paise: '5805000', entered_on: '2026-11-19' }, now)).toEqual({
      asOf: now.toISOString(), bank: { amount: 58050, enteredAt: '2026-11-19' }, settlements: null,
      vfulfillWallet: 190545.17, vfulfillAsOf: '2026-11-19', codDue: 4297, codDueOrders: 3,
      codDueByStore: [{ storeId: 'oorvia', amount: 2798, orders: 2 }, { storeId: 'kaiven', amount: 1499, orders: 1 }],
    })
  })

  it('settlement estimates: paise to rupees, store id checked; none read stays null', () => {
    expect(mapCash(wallet, [], null, now, [{ gateway: 'PayU', storeId: 'kaiven', paise: 146_362, orders: 1 }])!.settlements)
      .toEqual([{ gateway: 'PayU', storeId: 'kaiven', amount: 1463.62, orders: 1 }])
    expect(mapCash(wallet, [], null, now, [])!.settlements).toEqual([])
    expect(mapCash(wallet, [], null, now)!.settlements).toBeNull()
  })

  it('settlements alone are enough to show cash; an empty estimate alone is not', () => {
    const est = [{ gateway: 'Cashfree', storeId: 'oorvia', paise: 232_823, orders: 1 }]
    expect(mapCash(null, [], null, now, est)).toMatchObject({ settlements: [{ amount: 2328.23 }], bank: null, vfulfillWallet: 0 })
    expect(mapCash(null, [], null, now, [])).toBeNull()
  })

  it('no bank entered yet: bank is null, never 0', () => {
    expect(mapCash(wallet, [], null, now)!.bank).toBeNull()
  })

  it('null when nothing is wired at all', () => {
    expect(mapCash({ balance: 0, last_txn_date: null, transactions: 0 }, [], null, now)).toBeNull()
    expect(mapCash(null, [], null, now)).toBeNull()
  })

  it('a bank balance alone is enough to show cash', () => {
    expect(mapCash(null, [], { amount_paise: 100, entered_on: '2026-11-19' }, now)).toMatchObject({ bank: { amount: 1 }, vfulfillWallet: 0, vfulfillAsOf: null })
  })
})
