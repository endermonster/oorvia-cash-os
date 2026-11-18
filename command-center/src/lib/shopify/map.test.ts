import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyShopifyHmac } from './hmac'
import { classifyGateway, duplicateSkus, mapOrder, mapProduct, parseLandingUrl, tallyGateways, weightGrams, type GqlOrder, type GqlProduct, type ProductCtx } from './map'

// Fixtures follow the live shapes (Kaiven #KAI101131, Selnova's blank-SKU product).

const KAIVEN_URL = 'https://kaiven.in/products/deoxyribose-scalp-serum?utm_source=facebook&utm_medium=120253414519250028&utm_campaign=120253414822620028&campaign_id=120253414519250028&ad_id=120253414822710028&utm_id=120253414519250028'

const line = (over: Partial<GqlOrder['lineItems']['nodes'][number]> = {}) => ({
  id: 'gid://shopify/LineItem/1', sku: 'KV-DHS', currentQuantity: 2, originalUnitPriceSet: { shopMoney: { amount: '1499.00' } },
  product: { id: 'gid://shopify/Product/111' }, variant: { sku: 'KV-DHS' }, ...over,
})

const order = (over: Partial<GqlOrder> = {}): GqlOrder => ({
  id: 'gid://shopify/Order/6001', name: '#KAI101131', createdAt: '2026-11-17T14:30:00Z', updatedAt: '2026-11-17T14:35:00Z',
  cancelledAt: null, test: false, tags: [],
  currentTotalPriceSet: { shopMoney: { amount: '2998.00' } },
  paymentGatewayNames: ['Cash on Delivery (COD)'],
  shippingAddress: { city: 'Pune', province: 'Maharashtra', zip: '411001' },
  customAttributes: [{ key: 'landing_page_url', value: KAIVEN_URL }, { key: 'other', value: 'x' }],
  lineItems: { nodes: [line()] },
  ...over,
})

const noMap = new Map<string, string>()

describe('mapOrder', () => {
  it('maps a 2-unit COD order', () => {
    const { order: o, lines } = mapOrder('kaiven', order(), noMap)
    expect(o).toEqual({
      store_id: 'kaiven', order_name: '#KAI101131', shopify_order_id: 6001, placed_at: '2026-11-17T14:30:00Z', payment: 'cod',
      gateways: ['Cash on Delivery (COD)'], total_paise: 299800, primary_sku: 'KV-DHS', cancelled_at: null, is_test: false,
      city: 'Pune', state: 'Maharashtra', pincode: '411001', campaign_id: '120253414519250028', ad_id: '120253414822710028',
      landing_handle: 'deoxyribose-scalp-serum', shopify_updated_at: '2026-11-17T14:35:00Z',
    })
    expect(lines).toEqual([{ line_no: 1, sku: 'KV-DHS', qty: 2, unit_price_paise: 149900, shopify_product_id: 111 }])
  })

  it('treats any other gateway as prepaid, and matches COD by name or word', () => {
    expect(mapOrder('kaiven', order({ paymentGatewayNames: ['Razorpay Secure (UPI, Cards, Wallets, NetBanking)'] }), noMap).order.payment).toBe('prepaid')
    expect(mapOrder('kaiven', order({ paymentGatewayNames: ['COD'] }), noMap).order.payment).toBe('cod')
    expect(mapOrder('kaiven', order({ paymentGatewayNames: ['Razorpay', 'cash on delivery'] }), noMap).order.payment).toBe('cod')
    expect(mapOrder('kaiven', order({ paymentGatewayNames: ['Codex Pay'] }), noMap).order.payment).toBe('prepaid')
    expect(mapOrder('kaiven', order({ paymentGatewayNames: ['Shiprocket COD'] }), noMap).order.payment).toBe('cod')
    expect(mapOrder('kaiven', order({ paymentGatewayNames: ['manual'] }), noMap).order.payment).toBe('cod')
  })

  it('rounds the total to paise', () => {
    expect(mapOrder('kaiven', order({ currentTotalPriceSet: { shopMoney: { amount: '1399.10' } } }), noMap).order.total_paise).toBe(139910)
  })

  it('resolves a blank variant SKU through the product id', () => {
    const o = order({ lineItems: { nodes: [line({ sku: '', variant: { sku: null }, product: { id: 'gid://shopify/Product/222' } })] } })
    const { lines, order: row } = mapOrder('selnova', o, new Map([['222', 'SN-PDRN']]))
    expect(lines[0].sku).toBe('SN-PDRN')
    expect(row.primary_sku).toBe('SN-PDRN')
  })

  it('trims SKUs, and leaves a no-SKU add-on line with a null SKU that never becomes primary', () => {
    const o = order({
      lineItems: {
        nodes: [
          line({ sku: ' KV-DHS ', currentQuantity: 1 }),
          line({ id: 'gid://shopify/LineItem/2', sku: null, variant: null, product: null, currentQuantity: 1, originalUnitPriceSet: { shopMoney: { amount: '9999.00' } } }),
        ],
      },
    })
    const { lines, order: row } = mapOrder('kaiven', o, noMap)
    expect(lines.map((l) => l.sku)).toEqual(['KV-DHS', null])
    expect(row.primary_sku).toBe('KV-DHS')
  })

  it('picks the primary SKU by unit price times quantity', () => {
    const o = order({
      lineItems: {
        nodes: [
          line({ sku: 'CHEAP', currentQuantity: 3, originalUnitPriceSet: { shopMoney: { amount: '300.00' } } }), // 900
          line({ id: 'gid://shopify/LineItem/2', sku: 'DEAR', currentQuantity: 1, originalUnitPriceSet: { shopMoney: { amount: '1000.00' } } }), // 1000
        ],
      },
    })
    expect(mapOrder('kaiven', o, noMap).order.primary_sku).toBe('DEAR')
  })

  it('has a null primary SKU when no line has a SKU', () => {
    const o = order({ lineItems: { nodes: [line({ sku: null, variant: null, product: null })] } })
    expect(mapOrder('kaiven', o, noMap).order.primary_sku).toBeNull()
  })

  it('drops lines whose current quantity is 0 and numbers the rest', () => {
    const o = order({ lineItems: { nodes: [line({ sku: 'GONE', currentQuantity: 0 }), line({ id: 'gid://shopify/LineItem/2', sku: 'KEPT', currentQuantity: 1 })] } })
    const { lines, order: row } = mapOrder('kaiven', o, noMap)
    expect(lines).toEqual([{ line_no: 1, sku: 'KEPT', qty: 1, unit_price_paise: 149900, shopify_product_id: 111 }])
    expect(row.primary_sku).toBe('KEPT')
  })

  it('carries cancellation', () => {
    expect(mapOrder('kaiven', order({ cancelledAt: '2026-11-18T08:00:00Z' }), noMap).order.cancelled_at).toBe('2026-11-18T08:00:00Z')
  })

  it('flags test orders by Shopify flag or by an exact, case-insensitive "test" tag', () => {
    const t = (over: Partial<GqlOrder>) => mapOrder('selnova', order(over), noMap).order.is_test
    expect(t({ test: true })).toBe(true)
    expect(t({ tags: ['Test'] })).toBe(true)
    expect(t({ tags: ['vip', ' TEST '] })).toBe(true)
    expect(t({ tags: ['testing'] })).toBe(false)
    expect(t({ tags: ['contest'] })).toBe(false)
    expect(t({ tags: [] })).toBe(false)
  })

  it('keeps the product id on a line whose SKU did not resolve, and none on an add-on', () => {
    const o = order({
      lineItems: {
        nodes: [
          line({ sku: '', variant: { sku: null }, product: { id: 'gid://shopify/Product/222' } }),
          line({ id: 'gid://shopify/LineItem/2', sku: null, variant: null, product: null }),
        ],
      },
    })
    expect(mapOrder('selnova', o, noMap).lines.map((l) => [l.sku, l.shopify_product_id])).toEqual([[null, 222], [null, null]])
  })

  it('is null-safe without a shipping address or landing URL', () => {
    const { order: o } = mapOrder('kaiven', order({ shippingAddress: null, customAttributes: [] }), noMap)
    expect([o.city, o.state, o.pincode, o.campaign_id, o.ad_id, o.landing_handle]).toEqual([null, null, null, null, null, null])
  })
})

describe('parseLandingUrl', () => {
  it('ignores utm_medium even when it is the word paid, and falls back from campaign_id to utm_id', () => {
    const r = parseLandingUrl('https://oorvia.com/products/oorvia-microinfusion-system?utm_source=facebook&utm_medium=paid&utm_id=555&ad_id=777')
    expect(r).toEqual({ campaignId: '555', adId: '777', handle: 'oorvia-microinfusion-system' })
  })

  it('prefers campaign_id over utm_id', () => {
    expect(parseLandingUrl('https://x.in/products/p?utm_id=1&campaign_id=2').campaignId).toBe('2')
  })

  it('has no campaign when neither parameter is present', () => {
    expect(parseLandingUrl('https://x.in/products/p?utm_medium=paid').campaignId).toBeNull()
  })

  it('returns a null handle for a non-product path, and decodes an encoded handle', () => {
    expect(parseLandingUrl('https://kaiven.in/collections/all?campaign_id=9')).toEqual({ campaignId: '9', adId: null, handle: null })
    expect(parseLandingUrl('https://kaiven.in/').handle).toBeNull()
    expect(parseLandingUrl('https://kaiven.in/products/caf%C3%A9-serum').handle).toBe('café-serum')
  })

  it('accepts campaign_id and ad_id only when numeric (an unexpanded macro is null)', () => {
    expect(parseLandingUrl('https://x.in/products/p?campaign_id={{campaign.id}}&ad_id={{ad.id}}')).toEqual({ campaignId: null, adId: null, handle: 'p' })
    expect(parseLandingUrl('https://x.in/products/p?campaign_id={{campaign.id}}&utm_id=42').campaignId).toBe('42')
    expect(parseLandingUrl('https://x.in/products/p?campaign_id=12ab').campaignId).toBeNull()
  })

  it('finds the handle anywhere in the path, and in a relative URL', () => {
    expect(parseLandingUrl('https://x.in/en-in/products/p?x=1').handle).toBe('p')
    expect(parseLandingUrl('/products/p-2?campaign_id=7')).toEqual({ campaignId: '7', adId: null, handle: 'p-2' })
    expect(parseLandingUrl('https://x.in/products/p#frag').handle).toBe('p')
  })

  it('survives junk', () => {
    expect(parseLandingUrl('not a url')).toEqual({ campaignId: null, adId: null, handle: null })
    expect(parseLandingUrl(null)).toEqual({ campaignId: null, adId: null, handle: null })
  })
})

describe('classifyGateway', () => {
  it('classifies COD names after normalising case, spaces, underscores and hyphens', () => {
    for (const n of ['Cash on Delivery (COD)', 'cash_on_delivery', 'COD', 'Shiprocket COD', 'fastrr-cod', 'manual', 'Manual']) expect(classifyGateway(n), n).toBe('cod')
  })
  it('does not treat names that merely contain "cod" as COD', () => {
    expect(classifyGateway('Codex Pay')).toBe('unknown')
    expect(classifyGateway('Barcode Pay')).toBe('unknown')
  })
  it('knows the prepaid gateways', () => {
    for (const n of ['Razorpay Secure (UPI, Cards, Wallets, NetBanking)', 'PayU', 'Cashfree Payments', 'Shopify Payments', 'gift_card', 'GoKwik', 'Fastrr Prepaid']) expect(classifyGateway(n), n).toBe('prepaid')
  })
  it('reports anything else as unknown, and tallies only those', () => {
    expect(classifyGateway('Some New Wallet')).toBe('unknown')
    expect(tallyGateways([['Razorpay', 'Some New Wallet'], ['Some New Wallet', 'COD']])).toEqual({ 'Some New Wallet': 2 })
    expect(tallyGateways([['Razorpay', 'COD']], true)).toEqual({ Razorpay: 1, COD: 1 })
  })
})

// ── Products ─────────────────────────────────────────────────────────────────

const product = (over: Partial<GqlProduct> = {}, variant: Partial<GqlProduct['variants']['nodes'][number]> = {}): GqlProduct => ({
  id: 'gid://shopify/Product/111', title: 'Medicube Deoxyribose Scalp Serum', handle: 'deoxyribose-scalp-serum',
  variants: {
    nodes: [{
      id: 'gid://shopify/ProductVariant/1', sku: 'KV-DHS', price: '1499.00',
      inventoryItem: { unitCost: { amount: '300.00' }, measurement: { weight: { value: 0, unit: 'GRAMS' } } }, ...variant,
    }],
  },
  ...over,
})

const ctx = (over: Partial<ProductCtx> = {}): ProductCtx => ({
  existingByHandle: new Map(), latestCogsPaise: new Map(), today: '2026-11-18', ...over,
})

describe('mapProduct', () => {
  it('maps a new product, defaulting weight to 500 when Shopify says 0, and never sends stage', () => {
    const r = mapProduct('kaiven', product(), ctx())
    expect(r).toEqual({
      action: 'upsert',
      row: { store_id: 'kaiven', sku: 'KV-DHS', name: 'Medicube Deoxyribose Scalp Serum', price_paise: 149900, packed_weight_grams: 500, handle: 'deoxyribose-scalp-serum', shopify_product_id: 111 },
      cogs: { store_id: 'kaiven', sku: 'KV-DHS', cogs_paise: 30000, effective_from: '2026-11-18' },
    })
    expect('stage' in (r as { row: object }).row).toBe(false)
  })

  it('adds no cost entry when the cost is unchanged', () => {
    const r = mapProduct('kaiven', product(), ctx({ latestCogsPaise: new Map([['KV-DHS', 30000]]) }))
    expect(r.action === 'upsert' && r.cogs).toBeNull()
  })

  it('adds a new entry dated today when the cost changed', () => {
    const r = mapProduct('kaiven', product(), ctx({ latestCogsPaise: new Map([['KV-DHS', 25000]]) }))
    expect(r.action === 'upsert' && r.cogs).toEqual({ store_id: 'kaiven', sku: 'KV-DHS', cogs_paise: 30000, effective_from: '2026-11-18' })
  })

  it('does nothing about cost when Shopify has none', () => {
    const r = mapProduct('selnova', product({}, { inventoryItem: { unitCost: null, measurement: null } }), ctx({ latestCogsPaise: new Map([['KV-DHS', 30000]]) }))
    expect(r.action === 'upsert' && r.cogs).toBeNull()
  })

  it('converts weight to grams and keeps the existing weight when Shopify says 0', () => {
    expect(weightGrams({ value: 0.25, unit: 'KILOGRAMS' })).toBe(250)
    expect(weightGrams({ value: 8, unit: 'OUNCES' })).toBe(227)
    expect(weightGrams({ value: 0, unit: 'GRAMS' })).toBeNull()
    const heavy = product({}, { inventoryItem: { unitCost: null, measurement: { weight: { value: 0.75, unit: 'KILOGRAMS' } } } })
    expect(mapProduct('kaiven', heavy, ctx()).action === 'upsert' && (mapProduct('kaiven', heavy, ctx()) as { row: { packed_weight_grams: number } }).row.packed_weight_grams).toBe(750)
    const kept = mapProduct('kaiven', product(), ctx({ existingByHandle: new Map([['deoxyribose-scalp-serum', { sku: 'KV-DHS', packed_weight_grams: 640 }]]) }))
    expect(kept.action === 'upsert' && kept.row.packed_weight_grams).toBe(640)
  })

  const blank = product({ handle: 'pdrn-ampoule', id: 'gid://shopify/Product/222' }, { sku: '' })

  it('with a blank SKU and an existing row, keeps its SKU and only links the product id', () => {
    const r = mapProduct('selnova', blank, ctx({ existingByHandle: new Map([['pdrn-ampoule', { sku: 'SN-PDRN', packed_weight_grams: 500 }]]) }))
    expect(r).toEqual({ action: 'link', row: { store_id: 'selnova', sku: 'SN-PDRN', shopify_product_id: 222 }, cogs: null })
  })

  it('with a blank SKU and no existing row, skips and reports "no SKU"', () => {
    const r = mapProduct('selnova', blank, ctx())
    expect(r.action).toBe('skip')
    expect(r.action === 'skip' && r.reason).toMatch(/no SKU/)
  })

  it('skips multi-variant products with different SKUs, and reports it', () => {
    const p = product()
    p.variants.nodes.push({ ...p.variants.nodes[0], id: 'gid://shopify/ProductVariant/2', sku: 'KV-DHS-2' })
    const r = mapProduct('kaiven', p, ctx())
    expect(r.action).toBe('skip')
    expect(r.action === 'skip' && r.reason).toMatch(/multi-variant products not supported yet/)
  })

  it('skips a product whose variants overflow one page', () => {
    expect(mapProduct('kaiven', product({ variants: { ...product().variants, pageInfo: { hasNextPage: true } } }), ctx()).action).toBe('skip')
  })

  it('skips, rather than collides, when the SKU of a known handle changed in Shopify', () => {
    const r = mapProduct('kaiven', product(), ctx({ existingByHandle: new Map([['deoxyribose-scalp-serum', { sku: 'OLD', packed_weight_grams: 500 }]]) }))
    expect(r.action).toBe('skip')
  })
})

// ── Webhook HMAC ─────────────────────────────────────────────────────────────

describe('verifyShopifyHmac', () => {
  const body = JSON.stringify({ id: 6001, admin_graphql_api_id: 'gid://shopify/Order/6001' })
  const sign = (b: string, secret: string) => createHmac('sha256', secret).update(b, 'utf8').digest('base64')

  it('accepts a valid signature', () => {
    expect(verifyShopifyHmac(body, sign(body, 'shh'), 'shh')).toBe(true)
  })
  it('rejects a tampered body', () => {
    expect(verifyShopifyHmac(body.replace('6001', '6002'), sign(body, 'shh'), 'shh')).toBe(false)
  })
  it('rejects the wrong secret', () => {
    expect(verifyShopifyHmac(body, sign(body, 'shh'), 'other')).toBe(false)
  })
  it('rejects a missing, empty or wrong-length header without throwing', () => {
    expect(verifyShopifyHmac(body, null, 'shh')).toBe(false)
    expect(verifyShopifyHmac(body, '', 'shh')).toBe(false)
    expect(verifyShopifyHmac(body, 'abc', 'shh')).toBe(false)
  })
  it('rejects an empty secret', () => {
    expect(verifyShopifyHmac(body, sign(body, ''), '')).toBe(false)
  })
})

describe('duplicateSkus', () => {
  it('flags a SKU on two products (an A/B copy that kept its SKU), with both labels', () => {
    const d = duplicateSkus([
      { sku: 'KV-DHS', label: 'Scalp Serum (deoxyribose-scalp-serum)' },
      { sku: 'KV-DHS', label: 'Scalp Serum B (deoxyribose-scalp-serum-b)' },
      { sku: 'KV-OTHER', label: 'Other (other)' },
    ])
    expect([...d.keys()]).toEqual(['KV-DHS'])
    expect(d.get('KV-DHS')).toEqual(['Scalp Serum (deoxyribose-scalp-serum)', 'Scalp Serum B (deoxyribose-scalp-serum-b)'])
  })

  it('flags nothing once the copy has its own SKU', () => {
    expect(duplicateSkus([{ sku: 'KV-DHS', label: 'a' }, { sku: 'KV-DHS-T2', label: 'b' }]).size).toBe(0)
  })
})
