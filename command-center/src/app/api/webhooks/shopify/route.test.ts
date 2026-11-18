import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lookup = vi.fn<(domain: string) => Promise<string | null>>()
const sync = vi.fn<(storeId: string, gid: string, opts: { deadlineMs?: number }) => Promise<unknown>>()

vi.mock('@/lib/shopify/client', () => ({
  storeIdByDomain: (d: string) => lookup(d),
  clientSecret: () => 'secret',
  isTransient: (e: unknown) => e instanceof Error && e.message === 'transient',
}))
vi.mock('@/lib/shopify/sync', () => ({ syncOrder: (s: string, g: string, o: { deadlineMs?: number }) => sync(s, g, o) }))

const { POST } = await import('./route')

function webhook(body = JSON.stringify({ admin_graphql_api_id: 'gid://shopify/Order/1' })) {
  const hmac = createHmac('sha256', 'secret').update(body).digest('base64')
  return new Request('http://x/api/webhooks/shopify', {
    method: 'POST', body,
    headers: { 'x-shopify-shop-domain': 'kaiven.example', 'x-shopify-hmac-sha256': hmac },
  })
}

beforeEach(() => {
  lookup.mockReset().mockResolvedValue('kaiven')
  sync.mockReset().mockResolvedValue({})
})
afterEach(() => vi.useRealTimers())

describe('POST /api/webhooks/shopify', () => {
  it('answers 200 after syncing the order, with a Shopify budget of at most 3 s', async () => {
    const res = await POST(webhook())
    expect(res.status).toBe(200)
    expect(sync).toHaveBeenCalledWith('kaiven', 'gid://shopify/Order/1', expect.objectContaining({ deadlineMs: expect.any(Number) }))
    expect(sync.mock.calls[0][2].deadlineMs).toBeLessThanOrEqual(3000)
  })

  it('answers 500 at 4 s when a cold-start store lookup hangs', async () => {
    vi.useFakeTimers()
    lookup.mockReturnValue(new Promise(() => {}))
    const p = POST(webhook())
    await vi.advanceTimersByTimeAsync(4000)
    expect((await p).status).toBe(500)
    expect(sync).not.toHaveBeenCalled()
  })

  it('answers 500 at 4 s when the sync is still running', async () => {
    vi.useFakeTimers()
    sync.mockReturnValue(new Promise(() => {}))
    const p = POST(webhook())
    await vi.advanceTimersByTimeAsync(4000)
    expect((await p).status).toBe(500)
  })

  it('answers 500 when the store lookup fails', async () => {
    lookup.mockRejectedValue(new Error('cc_stores: service unavailable'))
    expect((await POST(webhook())).status).toBe(500)
  })

  it('answers 500 for a transient sync failure and 200 for a permanent one', async () => {
    sync.mockRejectedValueOnce(new Error('transient'))
    expect((await POST(webhook())).status).toBe(500)
    sync.mockRejectedValueOnce(new Error('bad data'))
    expect((await POST(webhook())).status).toBe(200)
  })

  it('answers 401 for a bad signature or an unknown shop', async () => {
    const bad = new Request('http://x', { method: 'POST', body: '{}', headers: { 'x-shopify-shop-domain': 'kaiven.example', 'x-shopify-hmac-sha256': 'nope' } })
    expect((await POST(bad)).status).toBe(401)
    lookup.mockResolvedValue(null)
    expect((await POST(webhook())).status).toBe(401)
  })
})
