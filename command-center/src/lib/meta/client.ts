import 'server-only'
import { AD_ACCOUNTS } from './accounts'

/** Graph API version the sync was tested against (v27.0 is the newest). */
export const GRAPH_VERSION = 'v27.0'
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`

/**
 * A failed Meta call. `transient` means a retry could succeed (network, 429, 5xx, rate limit). `kind` tells the
 * permanent ones apart: `no_access` (the ad account has not been shared with the system user) and `auth` (bad token).
 */
export class MetaError extends Error {
  constructor(
    message: string, readonly transient: boolean, readonly kind: 'no_access' | 'auth' | 'other' = 'other', readonly code?: number,
    /** From a Retry-After header, when Meta sent one. */
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'MetaError'
  }
}

/** Error codes that mean "try again": 1 and 2 (temporary or unknown), 4 and 17 (app and user rate limits), 341 (temporary), 613 (call rate), 80000-80014 (business-use-case limits). */
const isTransientCode = (c: number | undefined) =>
  c !== undefined && (c === 1 || c === 2 || c === 4 || c === 17 || c === 341 || c === 613 || (c >= 80000 && c <= 80014))

/** Removes any access token from text that may carry a URL, so it can never reach a message or a log. */
const scrub = (s: string) => s.replace(/access_token=[^&\s"')]+/gi, 'access_token=***')

/** Per call: `deadlineAt` (epoch ms) is one end-to-end budget (no retry or backoff past it, a request in flight is aborted); `timeoutMs` bounds each request. */
export type CallOpts = { deadlineAt?: number; timeoutMs?: number }

/**
 * Only Graph, only an allowlisted ad account: `me/adaccounts` and any other account are refused before anything is sent.
 * Covers paging URLs. Returns the ad account ID the URL addresses, which decides the token.
 */
const ALLOWED_PATH = new RegExp(`^/v\\d+\\.\\d+/act_(${AD_ACCOUNTS.map((a) => a.id).join('|')})(/|$)`)
function assertAllowed(url: string): string {
  let u: URL
  try { u = new URL(url) } catch { throw new MetaError('Meta: malformed URL refused', false) }
  const m = ALLOWED_PATH.exec(u.pathname)
  if (u.protocol !== 'https:' || u.port !== '' || u.username !== '' || u.password !== '' || u.hostname !== 'graph.facebook.com' || !m) {
    throw new MetaError(`Meta: request to ${u.pathname} refused, it is not an allowlisted ad account`, false)
  }
  return m[1]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const MAX_TRIES = 6
const backoff = (attempt: number) => Math.min(30000, 1000 * 2 ** attempt)
const REQUEST_TIMEOUT_MS = 60000
const MAX_PAGES = 500

type GraphErrorBody = { error?: { message?: string; code?: number; error_subcode?: number; is_transient?: boolean } }

/**
 * The token of the business portfolio that owns this ad account (each portfolio has its own system user). Read per
 * call, never written: overlapping syncs of different stores cannot pick up each other's token.
 */
function tokenFor(accountId: string): string {
  const account = AD_ACCOUNTS.find((a) => a.id === accountId)
  if (!account) throw new MetaError(`Meta: ad account ${accountId} is not allowlisted`, false)
  const t = process.env[account.tokenEnv]
  if (!t) throw new MetaError(`${account.tokenEnv} is not set: it is needed for ad account ${account.name} (${account.id})`, false, 'auth')
  return t
}

/** One request, no retry, to ad account `accountId` with its token. Returns the parsed body or throws a classified MetaError. */
async function once<T>(label: string, url: string, accountId: string, token: string, opts: CallOpts): Promise<T> {
  if (assertAllowed(url) !== accountId) throw new MetaError(`Meta ${label}: a URL for another ad account was refused`, false)
  const left = opts.deadlineAt === undefined ? Infinity : opts.deadlineAt - Date.now()
  if (left <= 0) throw new MetaError(`Meta ${label}: out of time`, true)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), Math.min(opts.timeoutMs ?? REQUEST_TIMEOUT_MS, left))
  let res: Response
  let text: string
  try {
    // The token goes in a header, never in the URL, so it cannot leak through a URL in a message.
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error', signal: ctl.signal })
    text = await res.text()
  } catch (e) {
    if (e instanceof MetaError) throw e
    if (ctl.signal.aborted) throw new MetaError(`Meta ${label}: timed out`, true)
    if (e instanceof TypeError) throw new MetaError(`Meta ${label}: network error`, true)
    throw e
  } finally {
    clearTimeout(timer)
  }

  let body: (GraphErrorBody & Record<string, unknown>) | null = null
  try { body = JSON.parse(text) } catch { /* not JSON */ }

  if (res.ok && body && !body.error) return body as T

  const err = body?.error
  const code = err?.code
  const msg = scrub(err?.message ?? `HTTP ${res.status}`)
  if (code === 190) throw new MetaError(`Meta ${label}: the access token is invalid or expired (code 190): ${msg}`, false, 'auth', code)
  if (code === 200 || code === 10) {
    throw new MetaError(`Meta ${label}: no access (code ${code}): ${msg}`, false, 'no_access', code)
  }
  const transient = res.status === 429 || res.status >= 500 || err?.is_transient === true || isTransientCode(code)
  const ra = Number(res.headers.get('retry-after'))
  const retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined
  throw new MetaError(`Meta ${label}: ${code !== undefined ? `code ${code}: ` : ''}${msg} (HTTP ${res.status})`, transient, 'other', code, retryAfterMs)
}

/** GET with retries on transient failures (backoff 2 s, 4 s, ... capped at 30 s; Retry-After wins when Meta sends it). Nothing runs past `deadlineAt`. */
async function getWithRetry<T>(label: string, url: string, accountId: string, token: string, opts: CallOpts): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await once<T>(label, url, accountId, token, opts)
    } catch (e) {
      if (!(e instanceof MetaError) || !e.transient) throw e
      const wait = Math.min(60000, e.retryAfterMs ?? backoff(attempt))
      const outOfTime = opts.deadlineAt !== undefined && Date.now() + wait >= opts.deadlineAt
      if (attempt >= MAX_TRIES || outOfTime) {
        throw new MetaError(`${e.message}, gave up after ${attempt} ${attempt === 1 ? 'try' : 'tries'}`, true, e.kind, e.code)
      }
      await sleep(wait)
    }
  }
}

type Params = Record<string, string | number>

const urlOf = (path: string, params: Params) => `${GRAPH}/${path}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`

/** One object, e.g. `act_123?fields=name`. */
export async function graphGet<T>(path: string, params: Params = {}, opts: CallOpts = {}): Promise<T> {
  const url = urlOf(path, params)
  const accountId = assertAllowed(url)
  return getWithRetry<T>(path, url, accountId, tokenFor(accountId), opts)
}

/**
 * Every item of a list endpoint, following `paging.next` until there is none (at most 500 pages; a repeated next URL
 * is an error). Every page goes to the first page's ad account with its token; a next URL for any other account is refused.
 */
export async function graphGetAll<T>(path: string, params: Params = {}, opts: CallOpts = {}): Promise<T[]> {
  const items: T[] = []
  const seen = new Set<string>()
  let url: string | undefined = urlOf(path, params)
  const accountId = assertAllowed(url)
  const token = tokenFor(accountId)
  while (url) {
    if (seen.has(url)) throw new MetaError(`Meta ${path}: paging loops (a next URL repeated)`, false)
    if (seen.size >= MAX_PAGES) throw new MetaError(`Meta ${path}: more than ${MAX_PAGES} pages`, false)
    seen.add(url)
    const page: { data?: T[]; paging?: { next?: string } } = await getWithRetry(path, url, accountId, token, opts)
    items.push(...(page.data ?? []))
    url = page.paging?.next
  }
  return items
}
