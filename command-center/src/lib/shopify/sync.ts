import 'server-only'
import { istNow } from '../dates'
import { dbError } from '../db-error'
import { selectAll } from '../paged'
import { supabase } from '../supabase'
import { withRun } from '../sync-run'
import { gql } from './client'
import {
  aliasesToWrite, classifyGateway, detectRename, duplicateSkus, mapOrder, mapProduct, tallyGateways, type CogsRowOut, type ExistingProduct, type GqlLine, type GqlOrder,
  type GqlProduct, type LineRowOut, type OrderRowOut, type ProductRowOut,
} from './map'

// ── Products ─────────────────────────────────────────────────────────────────

// Every status: relevantProducts hides dormant ones on screen.
const PRODUCTS_QUERY = `
query ($after: String) {
  products(first: 25, after: $after) {
    nodes {
      id title handle status
      variants(first: 10) {
        nodes { id sku price inventoryItem { unitCost { amount } measurement { weight { value unit } } } }
        pageInfo { hasNextPage }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`

type ProductsPage = { products: { nodes: GqlProduct[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }

export type ProductAction = { action: 'insert' | 'update' | 'link' | 'skip'; handle: string; sku?: string; matched: 'handle' | 'sku' | 'none'; reason?: string }

export type ProductsResult = {
  seen: number
  upserted: number
  linked: number
  cost_entries: number
  /** Problems on ACTIVE products: these need fixing. */
  skipped: string[]
  /** Skips on DRAFT or ARCHIVED products: counted, not reported. */
  skipped_inactive: number
  /** Renamed products (handle changed in Shopify): informational, not a problem. */
  info: string[]
  /** Dry run only: what each product would do, and the cost entries it would write. */
  plan?: { actions: ProductAction[]; costs: CogsRowOut[] }
}

/**
 * All products of a store: upserts cc_products (never `stage`) and writes a cost entry dated today when the
 * cost changed (a second change the same day replaces today's entry). `dryRun` reads and plans but writes
 * nothing, not even a cc_sync_runs row.
 */
export function syncProducts(storeId: string, opts: { dryRun?: boolean } = {}): Promise<ProductsResult> {
  return opts.dryRun ? runProducts(storeId, true) : withRun('shopify_products', storeId, () => runProducts(storeId, false))
}

async function runProducts(storeId: string, dryRun: boolean): Promise<ProductsResult> {
  const sb = supabase()
  const { today } = istNow(new Date())

  const existing = await selectAll<{ sku: string; handle: string; packed_weight_grams: number; shopify_product_id: number | string | null }>(
    () => sb.from('cc_products').select('sku, handle, packed_weight_grams, shopify_product_id').eq('store_id', storeId).order('sku'),
  )
  const handleByProductId = new Map<number, string>(existing.filter((r) => r.shopify_product_id !== null).map((r) => [Number(r.shopify_product_id), r.handle]))
  const existingByHandle = new Map<string, ExistingProduct>(existing.map((r) => [r.handle, { sku: r.sku, packed_weight_grams: Number(r.packed_weight_grams) }]))
  const skuByProductId = new Map<number, string>(existing.filter((r) => r.shopify_product_id !== null).map((r) => [Number(r.shopify_product_id), r.sku]))
  const existingSkus = new Set(existing.map((r) => r.sku))

  const history = await selectAll<{ sku: string; cogs_paise: number | string; effective_from: string }>(
    () => sb.from('cc_cogs_history').select('sku, cogs_paise, effective_from').eq('store_id', storeId).lte('effective_from', today).order('sku').order('effective_from'),
  )
  const latestCogsPaise = new Map<string, number>() // ordered ascending, so the last entry per SKU wins
  for (const h of history) latestCogsPaise.set(h.sku, Number(h.cogs_paise))

  // Collected first and written only after every product is seen: a SKU on two products updates neither.
  const upserts: { label: string; handle: string; matched: ProductAction['matched']; row: ProductRowOut; cogs: CogsRowOut | null; renamedFrom: string | null }[] = []
  const liveHandles = new Set<string>()
  const linkList: { label: string; handle: string; row: { store_id: string; sku: string; shopify_product_id: number } }[] = []
  const skipped: string[] = []
  let skippedInactive = 0
  const actions: ProductAction[] = []
  let seen = 0
  for (let after: string | null = null; ;) {
    const page: ProductsPage = await gql<ProductsPage>(storeId, PRODUCTS_QUERY, { after })
    for (const p of page.products.nodes) {
      seen++
      liveHandles.add(p.handle)
      const r = mapProduct(storeId, p, { existingByHandle, skuByProductId, latestCogsPaise, today })
      const byHandle = existingByHandle.has(p.handle)
      const label = `${p.title} (${p.handle})`
      if (r.action === 'skip') {
        if (p.status === 'ACTIVE') skipped.push(r.reason)
        else skippedInactive++
        actions.push({ action: 'skip', handle: p.handle, matched: byHandle ? 'handle' : 'none', reason: r.reason })
      } else if (r.action === 'link') {
        linkList.push({ label, handle: p.handle, row: r.row })
      } else {
        upserts.push({ label, handle: p.handle, matched: byHandle ? 'handle' : existingSkus.has(r.row.sku) ? 'sku' : 'none', row: r.row, cogs: r.cogs, renamedFrom: detectRename(handleByProductId, r.row.shopify_product_id, p.handle) })
      }
    }
    if (!page.products.pageInfo.hasNextPage) break
    after = page.products.pageInfo.endCursor
  }

  const dupes = duplicateSkus([...upserts, ...linkList].map((x) => ({ sku: x.row.sku, label: x.label })))
  for (const [sku, labels] of dupes) {
    skipped.push(`SKU ${sku} is on more than one product: ${labels.join(', ')}. None of them was updated: give each its own SKU (an A/B copy gets -T2)`)
  }
  const rows = new Map<string, ProductRowOut>()
  const costs: CogsRowOut[] = []
  const renames: { old: string; handle: string }[] = []
  for (const u of upserts) {
    if (dupes.has(u.row.sku)) { actions.push({ action: 'skip', handle: u.handle, sku: u.row.sku, matched: u.matched, reason: 'duplicate SKU' }); continue }
    rows.set(u.row.sku, u.row)
    if (u.renamedFrom !== null) renames.push({ old: u.renamedFrom, handle: u.row.handle }) // only for a row this run writes: its handle is what changes
    if (u.cogs) costs.push(u.cogs)
    actions.push({ action: u.matched === 'none' ? 'insert' : 'update', handle: u.handle, sku: u.row.sku, matched: u.matched })
  }
  const links: { store_id: string; sku: string; shopify_product_id: number }[] = []
  for (const l of linkList) {
    if (dupes.has(l.row.sku)) { actions.push({ action: 'skip', handle: l.handle, sku: l.row.sku, matched: 'handle', reason: 'duplicate SKU' }); continue }
    links.push(l.row)
    actions.push({ action: 'link', handle: l.handle, sku: l.row.sku, matched: 'handle' })
  }

  const aliases = aliasesToWrite(renames, liveHandles)
  // An alias whose old handle is a live product again (the handle was reused or restored) would send that product's traffic elsewhere.
  const storedAliases = await selectAll<{ old_handle: string; handle: string }>(
    () => sb.from('cc_handle_aliases').select('old_handle, handle').eq('store_id', storeId).order('old_handle'),
  )
  const revived = storedAliases.filter((a) => liveHandles.has(a.old_handle))
  const info: string[] = dryRun
    ? [
      ...aliases.map((a) => `renamed ${a.old} -> ${a.handle} (would alias it and move its campaigns)`),
      ...revived.map((a) => `alias ${a.old_handle} -> ${a.handle} would be removed: ${a.old_handle} is a live product again`),
    ]
    : []
  const result: ProductsResult = { seen, upserted: rows.size, linked: links.length, cost_entries: costs.length, skipped, skipped_inactive: skippedInactive, info }
  if (dryRun) return { ...result, plan: { actions, costs } }

  // Aliases and the campaign move go BEFORE the product upsert: if anything below fails, cc_products still holds the old
  // handle, so the next run detects the same rename again and finishes the job.
  for (const a of revived) {
    const { error, status } = await sb.from('cc_handle_aliases').delete().eq('store_id', storeId).eq('old_handle', a.old_handle)
    if (error) throw dbError('cc_handle_aliases', error, status)
    info.push(`alias ${a.old_handle} -> ${a.handle} removed: ${a.old_handle} is a live product again`)
  }
  for (const a of aliases) {
    // A rename back (B -> A after A -> B) must not leave a cycle: drop the alias that now points the wrong way.
    const del = await sb.from('cc_handle_aliases').delete().eq('store_id', storeId).eq('old_handle', a.handle)
    if (del.error) throw dbError('cc_handle_aliases', del.error, del.status)
    const { error, status } = await sb.from('cc_handle_aliases').upsert({ store_id: storeId, old_handle: a.old, handle: a.handle }, { onConflict: 'store_id,old_handle' })
    if (error) throw dbError('cc_handle_aliases', error, status)
    const moved = await sb.from('cc_campaigns').update({ landing_handle: a.handle }).eq('store_id', storeId).eq('landing_handle', a.old).select('campaign_id')
    if (moved.error) throw dbError('cc_campaigns', moved.error, moved.status)
    info.push(`renamed ${a.old} -> ${a.handle}: aliased, ${moved.data?.length ?? 0} campaigns moved`)
  }
  if (rows.size > 0) {
    const { error } = await sb.from('cc_products').upsert([...rows.values()], { onConflict: 'store_id,sku' })
    if (error) throw new Error(`cc_products: ${error.message}`)
  }
  for (const l of links) {
    const { error } = await sb.from('cc_products').update({ shopify_product_id: l.shopify_product_id }).eq('store_id', l.store_id).eq('sku', l.sku)
    if (error) throw new Error(`cc_products: ${error.message}`)
  }
  if (costs.length > 0) {
    // Never back-dates or edits an earlier entry: only today's, which a same-day change replaces.
    const { error } = await sb.from('cc_cogs_history').upsert(costs, { onConflict: 'store_id,sku,effective_from' })
    if (error) throw new Error(`cc_cogs_history: ${error.message}`)
  }
  return result
}

// ── Orders ───────────────────────────────────────────────────────────────────

const lineFields = 'nodes { id sku currentQuantity originalUnitPriceSet { shopMoney { amount } } product { id } variant { sku } } pageInfo { hasNextPage endCursor }'
const orderFields = (lines: number) => `
  id name createdAt updatedAt cancelledAt test tags
  currentTotalPriceSet { shopMoney { amount } }
  paymentGatewayNames
  shippingAddress { city province zip }
  customAttributes { key value }
  lineItems(first: ${lines}) { ${lineFields} }`

// Query cost is requested size: 50 orders x 10 lines stays well under the 1000-point cap. Overflowing orders are completed below.
const BACKFILL_QUERY = `
query ($after: String, $q: String) {
  orders(first: 50, after: $after, sortKey: UPDATED_AT, query: $q) {
    nodes { ${orderFields(10)} }
    pageInfo { hasNextPage endCursor }
  }
}`
const ORDER_QUERY = `query ($id: ID!) { order(id: $id) { ${orderFields(100)} } }`
const MORE_LINES_QUERY = `query ($id: ID!, $after: String) { order(id: $id) { lineItems(first: 100, after: $after) { ${lineFields} } } }`

type MoreLines = { order: { lineItems: { nodes: GqlLine[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null }

/** The product id to SKU map for a store, from cc_products. Run the product sync first. */
async function productIdToSku(storeId: string): Promise<Map<string, string>> {
  const sb = supabase()
  const rows = await selectAll<{ sku: string; shopify_product_id: number | string | null }>(
    () => sb.from('cc_products').select('sku, shopify_product_id').eq('store_id', storeId).not('shopify_product_id', 'is', null).order('sku'),
  )
  return new Map(rows.map((r) => [String(r.shopify_product_id), r.sku]))
}

async function completeLines(storeId: string, o: GqlOrder, deadlineAt?: number): Promise<GqlOrder> {
  let info = o.lineItems.pageInfo
  const nodes = [...o.lineItems.nodes]
  while (info?.hasNextPage) {
    const more: MoreLines = await gql<MoreLines>(storeId, MORE_LINES_QUERY, { id: o.id, after: info.endCursor }, { deadlineAt })
    if (!more.order) break
    nodes.push(...more.order.lineItems.nodes)
    info = more.order.lineItems.pageInfo
  }
  return { ...o, lineItems: { nodes } }
}

/** A product line whose SKU could not be resolved: it has a product, so it is not an add-on. */
const unresolved = (lines: LineRowOut[]) => lines.filter((l) => l.sku === null && l.shopify_product_id !== null)

type Prepared = { order: OrderRowOut; lines: LineRowOut[] }

async function prepare(storeId: string, o: GqlOrder, skuMap: Map<string, string>, deadlineAt?: number): Promise<Prepared> {
  return mapOrder(storeId, await completeLines(storeId, o, deadlineAt), skuMap)
}

/** Writes one prepared order through cc_upsert_order. True if written; false if a newer version is already stored. */
async function writeOrder({ order, lines }: Prepared): Promise<boolean> {
  const { data, error, status } = await supabase().rpc('cc_upsert_order', { p_order: order, p_lines: lines })
  if (error) throw dbError(`cc_upsert_order ${order.order_name}`, error, status) // keeps code and status: the webhook retries only transient failures
  return data === true
}

type OrdersPage = { orders: { nodes: GqlOrder[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }

export type OrdersResult = {
  seen: number
  written: number
  stale_ignored: number
  /** Product lines with no resolvable SKU (their cost is unknown). */
  unresolved_lines: number
  /** Gateway names that are neither a known COD nor a known prepaid gateway, with counts. */
  unknownGateways: Record<string, number>
  since?: string
  /** Dry run only. */
  plan?: {
    would_insert: number
    would_update: number
    gateways: { name: string; count: number; class: string }[]
    payment: { cod: number; prepaid: number }
    unresolved: { order: string; product_id: number }[]
  }
}

/**
 * Every order the API returns (without read_all_orders: the last 60 days), optionally only those updated since
 * a date. `dryRun` maps everything and reports what it would do, writing nothing (no cc_sync_runs row either).
 */
export function backfillOrders(storeId: string, opts: { since?: string; dryRun?: boolean } = {}): Promise<OrdersResult> {
  return opts.dryRun ? runBackfill(storeId, opts.since, true) : withRun('shopify_backfill', storeId, () => runBackfill(storeId, opts.since, false))
}

async function runBackfill(storeId: string, since: string | undefined, dryRun: boolean): Promise<OrdersResult> {
  const skuMap = await productIdToSku(storeId)
  const q = since ? `updated_at:>=${since}` : null

  let stored = new Map<string, number>()
  if (dryRun) {
    const sb = supabase()
    const rows = await selectAll<{ order_name: string; shopify_updated_at: string }>(
      () => sb.from('cc_orders').select('order_name, shopify_updated_at').eq('store_id', storeId).order('order_name'),
    )
    stored = new Map(rows.map((r) => [r.order_name, Date.parse(r.shopify_updated_at)]))
  }

  let seen = 0, written = 0, stale = 0, wouldInsert = 0, wouldUpdate = 0, unresolvedCount = 0
  const gatewayLists: string[][] = []
  const payment = { cod: 0, prepaid: 0 }
  const unresolvedList: { order: string; product_id: number }[] = []
  for (let after: string | null = null; ;) {
    const page: OrdersPage = await gql<OrdersPage>(storeId, BACKFILL_QUERY, { after, q })
    for (const o of page.orders.nodes) {
      seen++
      const prepared = await prepare(storeId, o, skuMap)
      gatewayLists.push(prepared.order.gateways)
      payment[prepared.order.payment]++
      const bad = unresolved(prepared.lines)
      unresolvedCount += bad.length
      for (const l of bad) unresolvedList.push({ order: prepared.order.order_name, product_id: l.shopify_product_id! })

      if (dryRun) {
        const prev = stored.get(prepared.order.order_name)
        if (prev === undefined) wouldInsert++
        else if (prev <= Date.parse(prepared.order.shopify_updated_at)) wouldUpdate++
        else stale++
      } else if (await writeOrder(prepared)) written++
      else stale++
    }
    if (!page.orders.pageInfo.hasNextPage) break
    after = page.orders.pageInfo.endCursor
  }

  const result: OrdersResult = {
    seen, written, stale_ignored: stale, unresolved_lines: unresolvedCount, unknownGateways: tallyGateways(gatewayLists),
    ...(since ? { since } : {}),
  }
  if (!dryRun) return result
  const all = tallyGateways(gatewayLists, true)
  return {
    ...result,
    plan: {
      would_insert: wouldInsert, would_update: wouldUpdate, payment,
      gateways: Object.entries(all).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count, class: classifyGateway(name) })),
      unresolved: unresolvedList,
    },
  }
}

export type OrderResult = { order: string; found: boolean; written: boolean; unresolved_lines: number; unknownGateways: Record<string, number> }

/**
 * Fetches one order fresh and upserts it: serves the webhook, so one mapper covers webhooks and backfill.
 * `deadlineMs` is one budget for all of its Shopify calls, starting now: requests and backoff waits stop when it runs out.
 */
export function syncOrder(
  storeId: string, orderGid: string, opts: { source?: 'shopify_webhook' | 'shopify_backfill'; deadlineMs?: number } = {},
): Promise<OrderResult> {
  const deadlineAt = opts.deadlineMs === undefined ? undefined : Date.now() + opts.deadlineMs
  return withRun(opts.source ?? 'shopify_webhook', storeId, async () => {
    const data = await gql<{ order: GqlOrder | null }>(storeId, ORDER_QUERY, { id: orderGid }, { deadlineAt })
    if (!data.order) return { order: orderGid, found: false, written: false, unresolved_lines: 0, unknownGateways: {} }
    const prepared = await prepare(storeId, data.order, await productIdToSku(storeId), deadlineAt)
    const wrote = await writeOrder(prepared)
    return {
      order: prepared.order.order_name, found: true, written: wrote,
      unresolved_lines: unresolved(prepared.lines).length, unknownGateways: tallyGateways([prepared.order.gateways]),
    }
  })
}
