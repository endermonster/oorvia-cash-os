import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('../supabase', () => ({
  supabase: () => ({
    from: () => ({ select: async () => ({ data: [{ id: 'kaiven', shopify_domain: 'kaiven.example' }], error: null, status: 200 }) }),
  }),
}))

const { gql, isTransient, ShopifyError } = await import('./client')
const { DbError } = await import('../db-error')

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const tokenResponse = () => json({ access_token: 't', expires_in: 86399 })

/** A fetch stub: token requests get a token, GraphQL requests get the next queued answer. */
function stubFetch(graphql: (() => Promise<Response>)[]) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push(url)
    if (url.endsWith('/admin/oauth/access_token')) return tokenResponse()
    const next = graphql.shift()
    if (!next) throw new Error('unexpected GraphQL call')
    // Honour abort like real fetch.
    return await new Promise<Response>((resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      next().then(resolve, reject)
    })
  }))
  return calls
}

beforeEach(() => {
  process.env.SHOPIFY_CLIENT_ID_KAIVEN = 'id'
  process.env.SHOPIFY_CLIENT_SECRET_KAIVEN = 'secret'
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('gql', () => {
  it('retries a GraphQL INTERNAL_SERVER_ERROR and returns the next good answer', async () => {
    vi.useFakeTimers()
    stubFetch([
      async () => json({ errors: [{ message: 'Internal error', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] }),
      async () => json({ data: { ok: 1 } }),
    ])
    const p = gql<{ ok: number }>('kaiven', '{ ok }')
    await vi.advanceTimersByTimeAsync(2000) // first backoff
    await expect(p).resolves.toEqual({ ok: 1 })
  })

  it('gives up on INTERNAL_SERVER_ERROR as transient when the deadline leaves no room to back off', async () => {
    stubFetch([async () => json({ errors: [{ message: 'Internal error', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] })])
    const e = await gql('kaiven', '{ ok }', {}, { deadlineAt: Date.now() + 500 }).catch((x) => x)
    expect(e).toBeInstanceOf(ShopifyError)
    expect(isTransient(e)).toBe(true)
  })

  it('still treats other GraphQL errors as permanent', async () => {
    stubFetch([async () => json({ errors: [{ message: 'Field does not exist' }] })])
    const e = await gql('kaiven', '{ nope }').catch((x) => x)
    expect(e).toBeInstanceOf(ShopifyError)
    expect(isTransient(e)).toBe(false)
  })

  it('aborts a request still running at the deadline, as transient', async () => {
    vi.useFakeTimers()
    stubFetch([() => new Promise<Response>(() => {})]) // never answers
    const p = gql('kaiven', '{ ok }', {}, { deadlineAt: Date.now() + 3000 }).catch((x) => x)
    await vi.advanceTimersByTimeAsync(3000)
    const e = await p
    expect(e).toBeInstanceOf(ShopifyError)
    expect((e as Error).message).toMatch(/timed out/)
    expect(isTransient(e)).toBe(true)
  })

  it('fails fast, as transient, when the deadline has already passed', async () => {
    const calls = stubFetch([])
    const e = await gql('kaiven', '{ ok }', {}, { deadlineAt: Date.now() - 1 }).catch((x) => x)
    expect(isTransient(e)).toBe(true)
    expect(calls.filter((u) => u.includes('graphql'))).toHaveLength(0)
  })
})

describe('isTransient', () => {
  it('uses a database error code, not its message', () => {
    expect(isTransient(new DbError('cc_upsert_order #1: canceling statement due to statement timeout', '57014', 500))).toBe(true)
    expect(isTransient(new DbError('cc_upsert_order #1: service unavailable', undefined, 503))).toBe(true)
    expect(isTransient(new DbError('cc_upsert_order #1: null value in column', '23502', 400))).toBe(false)
  })

  it('still retries a plain network failure', () => {
    expect(isTransient(new Error('TypeError: fetch failed'))).toBe(true)
    expect(isTransient(new Error('something else'))).toBe(false)
  })
})
