import { clientSecret, isTransient, storeIdByDomain } from '@/lib/shopify/client'
import { verifyShopifyHmac } from '@/lib/shopify/hmac'
import { syncOrder } from '@/lib/shopify/sync'

/** Shopify waits 5 s for a webhook answer. All Shopify calls share this budget, counted from arrival (requests and backoff waits)... */
const SHOPIFY_BUDGET_MS = 3000
/** ...and the handler answers by this long after the request arrived, whatever is still running (store lookup and database calls included). */
const RESPONSE_LIMIT_MS = 4000

const OUT_OF_TIME = Symbol('out of time')

/**
 * Shopify webhook receiver: orders/create, orders/updated, orders/cancelled.
 *
 * PUBLIC ROUTE. The HMAC signature is its only authentication, so when a login gate (proxy) is added
 * it must exempt exactly `/api/webhooks/shopify`.
 *
 * The body is only used to find the order id; the order is re-fetched through GraphQL so one mapper
 * serves webhooks and the backfill. Out-of-order deliveries are harmless: cc_upsert_order ignores a
 * version older than the stored one, and the upsert is idempotent, so a dropped retry is fine.
 *
 * Responses: 401 for an unknown shop, a shop with no secret configured, or a bad signature; 400 for a body
 * with no order id; 500 only when a retry could help (network, 429, 5xx, Shopify internal error, a temporary
 * database failure, or out of time);
 * 200 otherwise, including permanent failures, which are recorded as ok:false in cc_sync_runs.
 */
export async function POST(request: Request) {
  const arrived = Date.now()
  // The limit covers everything, from reading the body and the cold-start store lookup onward. If it wins, the
  // work keeps running: cc_upsert_order is one transaction and idempotent, so whether or not it commits,
  // Shopify's redelivery converges on the same row.
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<typeof OUT_OF_TIME>((resolve) => {
    timer = setTimeout(() => resolve(OUT_OF_TIME), RESPONSE_LIMIT_MS)
  })
  try {
    const r = await Promise.race([handle(request, arrived), limit])
    if (r === OUT_OF_TIME) {
      console.error(`shopify webhook: still running at ${RESPONSE_LIMIT_MS} ms, asked Shopify to retry`)
      return new Response('Retry', { status: 500 })
    }
    return r
  } catch (e) {
    // Only a failure outside the order sync gets here (the store lookup, reading the body): retry it.
    console.error(`shopify webhook: ${e instanceof Error ? e.message : String(e)}`)
    return new Response('Retry', { status: 500 })
  } finally {
    clearTimeout(timer)
  }
}

async function handle(request: Request, arrived: number): Promise<Response> {
  const raw = Buffer.from(await request.arrayBuffer()) // the HMAC covers the raw bytes: never re-serialise
  const domain = request.headers.get('x-shopify-shop-domain')
  const storeId = domain ? await storeIdByDomain(domain) : null
  if (!storeId) return new Response('Unauthorized', { status: 401 })

  let secret: string
  try {
    secret = clientSecret(storeId)
  } catch {
    console.error(`shopify webhook: no client secret configured for store ${storeId}`) // the store id only, never the secret
    return new Response('Unauthorized', { status: 401 })
  }
  if (!verifyShopifyHmac(raw, request.headers.get('x-shopify-hmac-sha256'), secret)) {
    return new Response('Unauthorized', { status: 401 })
  }

  let gid: string | null = null
  try {
    const body = JSON.parse(raw.toString('utf8')) as { admin_graphql_api_id?: string; id?: number | string }
    gid = body.admin_graphql_api_id ?? (body.id !== undefined ? `gid://shopify/Order/${body.id}` : null)
  } catch { /* handled below */ }
  if (!gid) return new Response('Bad request', { status: 400 })

  try {
    // The Shopify budget also counts from arrival, so a slow lookup above leaves less of it.
    await syncOrder(storeId, gid, { deadlineMs: Math.max(0, arrived + SHOPIFY_BUDGET_MS - Date.now()) })
  } catch (e) {
    // Already recorded in cc_sync_runs. Retrying only helps for transient failures.
    return isTransient(e) ? new Response('Retry', { status: 500 }) : new Response('ok', { status: 200 })
  }
  return new Response('ok', { status: 200 })
}
