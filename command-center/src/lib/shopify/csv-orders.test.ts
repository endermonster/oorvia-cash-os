import { describe, expect, it } from 'vitest'
import { csvRecords, parseCsv } from '../csv'
import { CSV_UPDATED_AT, csvPayment, csvTime, mapShopifyCsv, type CsvProduct } from './csv-orders'

const COLS = ['Name', 'Financial Status', 'Total', 'Created at', 'Cancelled at', 'Payment Method', 'Lineitem quantity', 'Lineitem name', 'Lineitem price',
  'Lineitem sku', 'Lineitem fulfillment status', 'Shipping City', 'Shipping Zip', 'Shipping Province', 'Shipping Province Name', 'Note Attributes', 'Id', 'Tags'] as const
type Row = Partial<Record<(typeof COLS)[number], string>>
const blank = Object.fromEntries(COLS.map((c) => [c, ''])) as Record<string, string>
/** First row of an order: order fields filled. */
const head = (r: Row) => ({ ...blank, 'Financial Status': 'paid', Total: '1499.00', 'Created at': '2026-04-02 10:05:09 +0530', 'Payment Method': 'Cash on Delivery (COD)',
  'Lineitem quantity': '1', 'Lineitem name': 'Yubi™ Bluetooth Ring', 'Lineitem price': '1499.00', 'Lineitem sku': 'YB31', 'Lineitem fulfillment status': 'fulfilled',
  'Shipping City': 'Pune', 'Shipping Zip': "'411001", 'Shipping Province': 'MH', 'Shipping Province Name': 'Maharashtra', Id: '6543210987654', ...r })
/** A later row of the same order: only the name and the line. */
const line = (r: Row) => ({ ...blank, 'Lineitem quantity': '1', 'Lineitem fulfillment status': 'fulfilled', ...r })

const PRODUCTS: CsvProduct[] = [
  { sku: 'YB31', name: 'Yubi™ Bluetooth Ring', shopify_product_id: 9106176770263 },
  { sku: 'PC31', name: 'Pillowcast™ Under-pillow Speaker', shopify_product_id: 9233903255767 },
]
const map = (rows: Record<string, string>[], since = '2026-01-01') => mapShopifyCsv(rows, { storeId: 'oorvia', prefix: '#OV', since, products: PRODUCTS })

describe('parseCsv', () => {
  it('handles quoted commas, doubled quotes, newlines inside quotes, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nline 2"\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"\nline 2']])
  })
  it('refuses a row with the wrong number of fields', () => {
    expect(() => csvRecords('a,b\n1\n')).toThrow(/row 2/)
  })
})

describe('Shopify export fields', () => {
  it('keeps the export time and its offset', () => {
    expect(csvTime('2026-03-21 23:40:00 +0530')).toBe('2026-03-21T23:40:00+05:30')
    expect(csvTime('')).toBeNull()
    expect(() => csvTime('21/03/2026')).toThrow()
  })
  it('payment: COD, prepaid gateways, and unknown when blank or unrecognised (never guessed)', () => {
    expect(csvPayment('Cash on Delivery (COD)')).toBe('cod')
    expect(csvPayment('Cashfree')).toBe('prepaid')
    expect(csvPayment('1Cashfree Payments(UPI,Cards,Net Banking,Wallets)')).toBe('prepaid')
    expect(csvPayment('01 Cards, UPI, NB, Wallets by Razorpay')).toBe('prepaid')
    expect(csvPayment('')).toBe('unknown')
    expect(csvPayment('Some New Gateway')).toBe('unknown')
  })
})

describe('mapShopifyCsv', () => {
  it('maps an order like the live sync: id, IST time, paise, address, never newer than a synced copy', () => {
    const { orders } = map([head({ Name: '#OV1001' })])
    expect(orders).toHaveLength(1)
    const o = orders[0].order
    expect(o).toMatchObject({
      store_id: 'oorvia', order_name: '#OV1001', shopify_order_id: 6543210987654, placed_at: '2026-04-02T10:05:09+05:30',
      payment: 'cod', total_paise: 149900, primary_sku: 'YB31', city: 'Pune', state: 'Maharashtra', pincode: '411001',
      cancelled_at: null, is_test: false, shopify_updated_at: CSV_UPDATED_AT,
    })
    expect(orders[0].lines).toEqual([{ line_no: 1, sku: 'YB31', qty: 1, unit_price_paise: 149900, shopify_product_id: null }])
  })

  it('groups later rows into the order and picks the highest-value line as primary', () => {
    const { orders } = map([
      head({ Name: '#OV1002', 'Lineitem price': '499.00', 'Lineitem sku': 'PC31' }),
      line({ Name: '#OV1002', 'Lineitem quantity': '2', 'Lineitem price': '1499.00', 'Lineitem sku': 'YB31' }),
    ])
    expect(orders[0].lines.map((l) => [l.sku, l.qty])).toEqual([['PC31', 1], ['YB31', 2]])
    expect(orders[0].order.primary_sku).toBe('YB31')
  })

  it('a blank-SKU line takes its SKU from the product name, even with the export mangling ™', () => {
    const { orders, report } = map([head({ Name: '#OV1003', 'Lineitem sku': '', 'Lineitem name': 'Pillowcast� Under-pillow Speaker' })])
    expect(orders[0].lines[0]).toMatchObject({ sku: 'PC31', shopify_product_id: 9233903255767 })
    expect(report.matchedByName).toEqual([{ order: '#OV1003', name: 'Pillowcast� Under-pillow Speaker', sku: 'PC31' }])
    expect(report.unresolved).toEqual([])
  })

  it('reports a blank-SKU line it cannot name, and a SKU no product has', () => {
    const { report } = map([head({ Name: '#OV1004', 'Lineitem sku': '', 'Lineitem name': 'Mystery thing' }), line({ Name: '#OV1004', 'Lineitem sku': 'OLD9', 'Lineitem price': '10' })])
    expect(report.unresolved).toEqual([{ order: '#OV1004', name: 'Mystery thing' }])
    expect(report.unknownSkus).toEqual({ OLD9: 1 })
  })

  it('a blank Payment Method stays unknown', () => {
    expect(map([head({ Name: '#OV1005', 'Payment Method': '', Total: '0.00' })]).orders[0].order.payment).toBe('unknown')
  })

  it('drops restocked lines and keeps the cancellation time', () => {
    const { orders } = map([head({ Name: '#OV1006', 'Cancelled at': '2026-04-03 09:00:00 +0530', 'Lineitem fulfillment status': 'restocked' })])
    expect(orders[0].order.cancelled_at).toBe('2026-04-03T09:00:00+05:30')
    expect(orders[0].lines).toEqual([])
    expect(orders[0].order.primary_sku).toBeNull()
  })

  it('reads campaign and landing product from the landing_page_url note attribute', () => {
    const notes = 'additional_charge: 0.0\nlanding_page_url: https://oorvia.com/products/yubi-bluetooth-ring?campaign_id=120255893889280357&ad_id=120255893614950357\nutm_source: fb'
    expect(map([head({ Name: '#OV1007', 'Note Attributes': notes })]).orders[0].order).toMatchObject({
      campaign_id: '120255893889280357', ad_id: '120255893614950357', landing_handle: 'yubi-bluetooth-ring',
    })
  })

  it('skips other stores and orders before `since` (by IST date)', () => {
    const { orders, report } = map([
      head({ Name: '#OV1008', 'Created at': '2025-12-31 23:59:59 +0530' }),
      head({ Name: '#OV1009', 'Created at': '2026-01-01 00:00:01 +0530' }),
      head({ Name: '#KAI1001' }),
    ])
    expect(orders.map((o) => o.order.order_name)).toEqual(['#OV1009'])
    expect(report.skipped).toBe(2)
  })

  it('refuses a row with no Id', () => {
    expect(() => map([head({ Name: '#OV1010', Id: '' })])).toThrow(/bad Id/)
  })
})
