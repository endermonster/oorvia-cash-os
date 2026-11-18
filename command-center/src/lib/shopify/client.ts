import 'server-only'
import { DbError, dbError, isRetryableDb } from '../db-error'
import { supabase } from '../supabase'

/** Admin API version the app was tested against. */
export const API_VERSION = '2026-10'

type Credentials = { clientId: string; clientSecret: string }

/** Env suffix for a store: its id, uppercased (kaiven -> KAIVEN). */
const suffix = (storeId: string) => storeId.toUpperCase()

export function credentials(storeId: string): Credentials {
  const clientId = process.env[`SHOPIFY_CLIENT_ID_${suffix(storeId)}`]
  const clientSecret = process.env[`SHOPIFY_CLIENT_SECRET_${suffix(storeId)}`]
  if (!clientId || !clientSecret) throw new Error(`Shopify credentials are not set for store "${storeId}"`)
  return { clientId, clientSecret }
}

/** The client secret for a store, for webhook verification. Never log it. Throws if it is not configured. */
export const clientSecret = (storeId: string) => credentials(storeId).clientSecret

// ── Store lookup (cc_stores), cached for the life of the process ─────────────

type StoreInfo = { id: string; domain: string }
let storeCache: StoreInfo[] | null = null

async function stores(): Promise<StoreInfo[]> {
  if (storeCache) return storeCache
  const { data, error, status } = await supabase().from('cc_stores').select('id, shopify_domain')
  if (error) throw dbError('cc_stores', error, status)
  storeCache = (data ?? []).filter((r) => r.shopify_domain).map((r) => ({ id: r.id as string, domain: r.shopify_domain as string }))
  return storeCache
}

export async function domainOf(storeId: string): Promise<string> {
  const s = (await stores()).find((x) => x.id === storeId)
  if (!s) throw new Error(`Unknown store "${storeId}" or no shopify_domain`)
  return s.domain
}

export async function storeIdByDomain(domain: string): Promise<string | null> {
  return (await stores()).find((x) => x.domain.toLowerCase() === domain.toLowerCase())?.id ?? null
}

export async function allStoreIds(): Promise<string[]> {
  return (await stores()).map((s) => s.id)
}

// ── Token: client credentials grant, cached per store, refreshed 60 s early ──

type Token = { value: string; expiresAt: number }
const tokens = new Map<string, Token>()
const inflight = new Map<string, Promise<string>>()

async function fetchToken(storeId: string, deadlineAt?: number): Promise<string> {
  const { clientId, clientSecret: secret } = credentials(storeId)
  const label = `Shopify token request for "${storeId}"`
  const j = await timedFetch(label, `https://${await domainOf(storeId)}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret }).toString(),
    cache: 'no-store',
  }, deadlineAt, async (res) => {
    if (!res.ok) throw new ShopifyError(`${label} failed: HTTP ${res.status}`, res.status === 429 || res.status >= 500)
    return (await res.json()) as { access_token?: string; expires_in?: number }
  })
  if (!j.access_token) throw new Error(`Shopify token response for "${storeId}" had no access_token`)
  tokens.set(storeId, { value: j.access_token, expiresAt: Date.now() + ((j.expires_in ?? 86399) - 60) * 1000 })
  return j.access_token
}

/** `deadlineAt` (epoch ms) aborts a token request still running then. A request already in flight is shared. */
export async function accessToken(storeId: string, deadlineAt?: number): Promise<string> {
  const hit = tokens.get(storeId)
  if (hit && hit.expiresAt > Date.now()) return hit.value
  let p = inflight.get(storeId)
  if (!p) {
    p = fetchToken(storeId, deadlineAt).finally(() => inflight.delete(storeId))
    inflight.set(storeId, p)
  }
  return p
}

// ── GraphQL with throttle backoff ────────────────────────────────────────────

/**
 * A failed Shopify call. `transient` means a retry could succeed (network, 429, 5xx, throttle): a webhook
 * answers 500 so Shopify redelivers. Anything else (a 4xx, a GraphQL error) will fail the same way again.
 */
export class ShopifyError extends Error {
  constructor(message: string, readonly transient: boolean) {
    super(message)
    this.name = 'ShopifyError'
  }
}

type GqlError = { message: string; extensions?: { code?: string } }
type Cost = { requestedQueryCost?: number; throttleStatus?: { currentlyAvailable: number; restoreRate: number } }
type GqlResponse<T> = { data?: T; errors?: GqlError[]; extensions?: { cost?: Cost } }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const MAX_TRIES = 8
const backoff = (attempt: number) => Math.min(30000, 1000 * 2 ** attempt)

/**
 * fetch, plus reading the body in `read`, aborted at `deadlineAt` (epoch ms) if one is given. A timeout or
 * network failure is a transient ShopifyError; an error thrown by `read` passes through unchanged.
 */
async function timedFetch<R>(
  label: string, url: string, init: RequestInit, deadlineAt: number | undefined, read: (res: Response) => Promise<R>,
): Promise<R> {
  const left = deadlineAt === undefined ? undefined : deadlineAt - Date.now()
  if (left !== undefined && left <= 0) throw new ShopifyError(`${label}: out of time`, true)
  const ctl = new AbortController()
  const timer = left === undefined ? null : setTimeout(() => ctl.abort(), left)
  try {
    return await read(await fetch(url, { ...init, signal: ctl.signal }))
  } catch (e) {
    if (ctl.signal.aborted) throw new ShopifyError(`${label}: timed out`, true)
    if (e instanceof TypeError) throw new ShopifyError(`${label}: network error`, true) // what fetch throws when it can't connect
    throw e
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * `deadlineAt` (epoch ms) is one end-to-end budget for the call: requests still running then are aborted and
 * no backoff wait may run past it. The webhook shares one deadline across all its calls so it can answer
 * "retry" inside Shopify's response window. Its upsert is idempotent, so a dropped delivery is safe to retry.
 */
export async function gql<T>(
  storeId: string, query: string, variables: Record<string, unknown> = {}, opts: { deadlineAt?: number } = {},
): Promise<T> {
  const { deadlineAt } = opts
  const domain = await domainOf(storeId)
  const started = Date.now()
  const wait = async (ms: number, why: string) => {
    if (deadlineAt !== undefined && Date.now() + ms > deadlineAt) {
      throw new ShopifyError(`Shopify ${storeId}: ${why}, gave up after ${Date.now() - started} ms`, true)
    }
    await sleep(ms)
  }
  let refreshed = false
  for (let attempt = 1; ; attempt++) {
    const token = await accessToken(storeId, deadlineAt)
    const r = await timedFetch(`Shopify ${storeId}`, `https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
      cache: 'no-store',
    }, deadlineAt, async (res) => ({
      status: res.status,
      retryAfter: res.headers.get('retry-after'),
      body: res.ok ? ((await res.json()) as GqlResponse<T>) : null,
    }))

    if (r.status === 401 && !refreshed) { // token revoked or expired early: get a new one once
      refreshed = true
      tokens.delete(storeId)
      continue
    }
    if (r.status === 429 || r.status >= 500) {
      if (attempt >= MAX_TRIES) throw new ShopifyError(`Shopify ${storeId}: HTTP ${r.status} after ${attempt} tries`, true)
      await wait(Number(r.retryAfter ?? 0) * 1000 || backoff(attempt), `HTTP ${r.status}`)
      continue
    }
    if (!r.body) throw new ShopifyError(`Shopify ${storeId}: HTTP ${r.status}`, false)

    const body = r.body
    if (body.errors?.some((e) => e.extensions?.code === 'THROTTLED')) {
      if (attempt >= MAX_TRIES) throw new ShopifyError(`Shopify ${storeId}: still throttled after ${attempt} tries`, true)
      const c = body.extensions?.cost
      const rate = c?.throttleStatus?.restoreRate ?? 50
      const need = (c?.requestedQueryCost ?? 0) - (c?.throttleStatus?.currentlyAvailable ?? 0)
      await wait(Math.min(30000, Math.max(1000, Math.ceil((need / rate) * 1000) + 250)), 'throttled')
      continue
    }
    // Shopify can answer HTTP 200 with INTERNAL_SERVER_ERROR: a fault on its side, so retry like a 5xx.
    if (body.errors?.some((e) => e.extensions?.code === 'INTERNAL_SERVER_ERROR')) {
      if (attempt >= MAX_TRIES) throw new ShopifyError(`Shopify ${storeId}: internal server error after ${attempt} tries`, true)
      await wait(backoff(attempt), 'internal server error')
      continue
    }
    if (body.errors?.length) throw new ShopifyError(`Shopify ${storeId}: ${body.errors.map((e) => e.message).join('; ')}`, false)
    if (!body.data) throw new ShopifyError(`Shopify ${storeId}: empty response`, false)
    return body.data
  }
}

/**
 * True for failures worth a retry: transient Shopify errors, transient database errors (timeouts, connection
 * and overload, by code and HTTP status), and network trouble reaching either.
 */
export function isTransient(e: unknown): boolean {
  if (e instanceof ShopifyError || e instanceof DbError) return e.transient
  const m = e instanceof Error ? e.message : String(e)
  return isRetryableDb(undefined, undefined, m)
}
