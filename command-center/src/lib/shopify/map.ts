/**
 * Pure mapping from Shopify Admin GraphQL shapes to the cc_* rows. No I/O: the sync module fetches,
 * this module decides. Money is integer paise.
 */

// ── GraphQL shapes (only the fields the queries ask for) ─────────────────────

type Money = { shopMoney: { amount: string } }

export type GqlLine = {
  id: string
  sku: string | null
  currentQuantity: number
  originalUnitPriceSet: Money
  product: { id: string } | null
  variant: { sku: string | null } | null
}

export type GqlOrder = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  cancelledAt: string | null
  test: boolean
  tags: string[]
  currentTotalPriceSet: Money
  paymentGatewayNames: string[]
  shippingAddress: { city: string | null; province: string | null; zip: string | null } | null
  customAttributes: { key: string; value: string | null }[]
  lineItems: { nodes: GqlLine[]; pageInfo?: { hasNextPage: boolean; endCursor: string | null } }
}

export type GqlVariant = {
  id: string
  sku: string | null
  price: string
  inventoryItem: {
    unitCost: { amount: string } | null
    measurement: { weight: { value: number; unit: string } | null } | null
  } | null
}

export type GqlProduct = {
  id: string
  title: string
  handle: string
  /** ACTIVE, DRAFT or ARCHIVED. Only an ACTIVE product's problems are reported. */
  status?: string
  variants: { nodes: GqlVariant[]; pageInfo?: { hasNextPage: boolean } }
}

// ── Output rows (snake_case, as the tables) ──────────────────────────────────

export type OrderRowOut = {
  store_id: string
  order_name: string
  shopify_order_id: number
  placed_at: string
  payment: 'cod' | 'prepaid'
  gateways: string[]
  total_paise: number
  primary_sku: string | null
  cancelled_at: string | null
  is_test: boolean
  city: string | null
  state: string | null
  pincode: string | null
  campaign_id: string | null
  ad_id: string | null
  landing_handle: string | null
  shopify_updated_at: string
}
/** `shopify_product_id` is kept so a product line with no resolvable SKU is told apart from an add-on (shipping protection). */
export type LineRowOut = { line_no: number; sku: string | null; qty: number; unit_price_paise: number; shopify_product_id: number | null }

// ── Helpers ──────────────────────────────────────────────────────────────────

/** The numeric part of a Shopify GID: gid://shopify/Order/123 -> '123'. */
export const gidNum = (gid: string): string => gid.slice(gid.lastIndexOf('/') + 1)

const paise = (amount: string) => Math.round(Number(amount) * 100)
const clean = (v: string | null | undefined) => {
  const t = v?.trim()
  return t ? t : null
}

/** campaign_id, ad_id and landing handle from Fastrr's `landing_page_url` custom attribute. */
export function parseLandingUrl(raw: string | null | undefined): { campaignId: string | null; adId: string | null; handle: string | null } {
  const none = { campaignId: null, adId: null, handle: null }
  if (!raw) return none
  let url: URL
  try { url = new URL(raw, 'https://x') } catch { return none }
  const q = url.searchParams
  // IDs are numeric. An unexpanded macro such as {{campaign.id}} is not an ID.
  const id = (v: string | null) => { const t = clean(v); return t !== null && /^\d+$/.test(t) ? t : null }
  // utm_medium is deliberately ignored: on some ads it is the word "paid", not an ID.
  const campaignId = id(q.get('campaign_id')) ?? id(q.get('utm_id'))
  const adId = id(q.get('ad_id'))
  const m = /\/products\/([^/?#]+)/.exec(url.pathname)
  let handle: string | null = null
  if (m) {
    try { handle = decodeURIComponent(m[1]) } catch { handle = m[1] }
  }
  return { campaignId, adId, handle }
}

export type GatewayClass = 'cod' | 'prepaid' | 'unknown'

const PREPAID_GATEWAYS = ['razorpay', 'payu', 'cashfree', 'shopifypayments', 'giftcard', 'gokwik', 'prepaid', 'phonepe', 'paytm', 'stripe', 'paypal', 'bogus']

/**
 * Classifies a Shopify payment gateway name. Normalised like the old app (lowercase, whitespace, underscores and
 * hyphens stripped): COD is "cash on delivery", a name that is or ends in "cod" (shiprocketcod, fastrrcod),
 * or the manual gateway. Names that are neither COD nor a known prepaid gateway are 'unknown', and the sync
 * reports them so a new COD gateway cannot hide as prepaid.
 */
export function classifyGateway(name: string): GatewayClass {
  const n = name.toLowerCase().replace(/[\s_-]/g, '')
  if (n.includes('cashondelivery') || n === 'manual' || n.endsWith('cod')) return 'cod'
  if (PREPAID_GATEWAYS.some((k) => n.includes(k))) return 'prepaid'
  return 'unknown'
}

export const isCod = (gateways: string[]) => gateways.some((g) => classifyGateway(g) === 'cod')

/** Counts the gateway names classified 'unknown' (or all names with their class, when `all`). */
export function tallyGateways(lists: string[][], all = false): Record<string, number> {
  const out: Record<string, number> = {}
  for (const gs of lists) {
    for (const g of gs) {
      if (all || classifyGateway(g) === 'unknown') out[g] = (out[g] ?? 0) + 1
    }
  }
  return out
}

/**
 * One order and its lines. `productIdToSku` maps numeric Shopify product ids to the SKU in cc_products,
 * to resolve a blank variant SKU. Lines with currentQuantity 0 (removed or fully refunded) are dropped.
 */
export function mapOrder(
  storeId: string,
  o: GqlOrder,
  productIdToSku: ReadonlyMap<string, string>,
): { order: OrderRowOut; lines: LineRowOut[] } {
  const live = o.lineItems.nodes.filter((l) => l.currentQuantity > 0)
  const lines: LineRowOut[] = live.map((l, i) => {
    const own = clean(l.sku) ?? clean(l.variant?.sku)
    const sku = own ?? (l.product ? productIdToSku.get(gidNum(l.product.id)) ?? null : null)
    return {
      line_no: i + 1, sku, qty: l.currentQuantity, unit_price_paise: paise(l.originalUnitPriceSet.shopMoney.amount),
      shopify_product_id: l.product ? Number(gidNum(l.product.id)) : null,
    }
  })

  let primary: LineRowOut | null = null
  for (const l of lines) {
    if (l.sku === null) continue
    if (!primary || l.unit_price_paise * l.qty > primary.unit_price_paise * primary.qty) primary = l
  }

  const landing = parseLandingUrl(o.customAttributes.find((a) => a.key === 'landing_page_url')?.value)
  const addr = o.shippingAddress
  return {
    order: {
      store_id: storeId,
      order_name: o.name,
      shopify_order_id: Number(gidNum(o.id)),
      placed_at: o.createdAt,
      payment: isCod(o.paymentGatewayNames) ? 'cod' : 'prepaid',
      gateways: o.paymentGatewayNames,
      total_paise: paise(o.currentTotalPriceSet.shopMoney.amount),
      primary_sku: primary?.sku ?? null,
      cancelled_at: o.cancelledAt,
      // Shopify only sets `test` for test-gateway orders; a hand-made COD test order is tagged "test" instead.
      is_test: o.test || (o.tags ?? []).some((t) => t.trim().toLowerCase() === 'test'),
      city: clean(addr?.city),
      state: clean(addr?.province),
      pincode: clean(addr?.zip),
      campaign_id: landing.campaignId,
      ad_id: landing.adId,
      landing_handle: landing.handle,
      shopify_updated_at: o.updatedAt,
    },
    lines,
  }
}

// ── Products ─────────────────────────────────────────────────────────────────

/** A cc_products row already in the database. */
export type ExistingProduct = { sku: string; packed_weight_grams: number }

export type ProductCtx = {
  /** Existing rows for this store, by handle. */
  existingByHandle: ReadonlyMap<string, ExistingProduct>
  /** Stored SKU of each linked Shopify product of this store, by product ID: catches a SKU changed together with the handle. */
  skuByProductId?: ReadonlyMap<number, string>
  /** Latest cc_cogs_history entry per SKU in this store, in paise. */
  latestCogsPaise: ReadonlyMap<string, number>
  /** YYYY-MM-DD, IST: the effective date of a new cost entry. */
  today: string
}

export type ProductRowOut = {
  store_id: string; sku: string; name: string; price_paise: number; packed_weight_grams: number; handle: string; shopify_product_id: number
}
export type CogsRowOut = { store_id: string; sku: string; cogs_paise: number; effective_from: string }

export type ProductResult =
  | { action: 'upsert'; row: ProductRowOut; cogs: CogsRowOut | null }
  /** Blank SKU in Shopify, row already set up: only attach the Shopify product id. */
  | { action: 'link'; row: { store_id: string; sku: string; shopify_product_id: number }; cogs: null }
  | { action: 'skip'; reason: string }

/**
 * The handle a product used to have, when Shopify now gives it a different one: `stored` maps a Shopify product id
 * to the handle in cc_products. Null when the product is new to us, or its handle is unchanged.
 */
export function detectRename(stored: ReadonlyMap<number, string>, productId: number, handle: string): string | null {
  const old = stored.get(productId)
  return old !== undefined && old !== handle ? old : null
}

/**
 * Of the renames found, those safe to record as aliases: the old handle must not be a live handle of a Shopify
 * product now (a reused handle would send its traffic to the wrong product).
 */
export function aliasesToWrite(renames: { old: string; handle: string }[], liveHandles: ReadonlySet<string>): { old: string; handle: string }[] {
  return renames.filter((r) => !liveHandles.has(r.old))
}

/**
 * SKUs that more than one Shopify product claims, with those products' labels. Writing either would overwrite
 * the other's price, cost and link (cc_products is keyed by store + SKU), so the sync updates none of them.
 */
export function duplicateSkus(items: { sku: string; label: string }[]): Map<string, string[]> {
  const bySku = new Map<string, string[]>()
  for (const { sku, label } of items) bySku.set(sku, [...(bySku.get(sku) ?? []), label])
  return new Map([...bySku].filter(([, labels]) => labels.length > 1))
}

const GRAMS_PER: Record<string, number> = { GRAMS: 1, KILOGRAMS: 1000, OUNCES: 28.349523125, POUNDS: 453.59237 }

export function weightGrams(w: { value: number; unit: string } | null | undefined): number | null {
  if (!w || !(w.value > 0)) return null
  const per = GRAMS_PER[w.unit]
  if (!per) return null
  return Math.max(1, Math.round(w.value * per))
}

/**
 * One cc_products row per product (the first variant), plus a cost entry when Shopify's unit cost
 * differs from the latest on record. Never touches `stage` and never edits or back-dates a cost entry.
 */
export function mapProduct(storeId: string, p: GqlProduct, ctx: ProductCtx): ProductResult {
  const label = `${p.title} (${p.handle})`
  const variants = p.variants.nodes
  if (variants.length === 0) return { action: 'skip', reason: `${label}: no variants` }
  const skus = new Set(variants.map((v) => clean(v.sku)).filter((s): s is string => s !== null))
  if (skus.size > 1 || p.variants.pageInfo?.hasNextPage) return { action: 'skip', reason: `${label}: multi-variant products not supported yet` }

  const v = variants[0]
  const existing = ctx.existingByHandle.get(p.handle)
  const shopifyProductId = Number(gidNum(p.id))
  const shopifySku = [...skus][0] ?? null

  if (shopifySku === null) {
    if (!existing) return { action: 'skip', reason: `${label}: no SKU` }
    return { action: 'link', row: { store_id: storeId, sku: existing.sku, shopify_product_id: shopifyProductId }, cogs: null }
  }
  // By handle, or by product ID when the handle changed too (else a second row would be inserted for the same product).
  const setUpAs = existing?.sku ?? ctx.skuByProductId?.get(shopifyProductId)
  if (setUpAs !== undefined && setUpAs !== shopifySku) {
    return { action: 'skip', reason: `${label}: set up as SKU ${setUpAs} but Shopify now says ${shopifySku}; fix by hand` }
  }

  const row: ProductRowOut = {
    store_id: storeId,
    sku: shopifySku,
    name: p.title,
    price_paise: paise(v.price),
    packed_weight_grams: weightGrams(v.inventoryItem?.measurement?.weight) ?? existing?.packed_weight_grams ?? 500,
    handle: p.handle,
    shopify_product_id: shopifyProductId,
  }

  const cost = v.inventoryItem?.unitCost
  let cogs: CogsRowOut | null = null
  if (cost) {
    const cogsPaise = paise(cost.amount)
    if (ctx.latestCogsPaise.get(shopifySku) !== cogsPaise) {
      cogs = { store_id: storeId, sku: shopifySku, cogs_paise: cogsPaise, effective_from: ctx.today }
    }
  }
  return { action: 'upsert', row, cogs }
}
