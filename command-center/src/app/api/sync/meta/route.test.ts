import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  calls: [] as { store: string; opts: { deadlineAt?: number; requestTimeoutMs?: number } }[],
  answers: {} as Record<string, object | Error>,
  signedIn: true,
}))
const invalidate = vi.fn()
// The dashboard cache exists only inside Next.
vi.mock('@/lib/cached', () => ({ invalidateData: () => invalidate() }))
vi.mock('@/lib/auth/server', () => ({ allowedUser: async () => (h.signedIn ? { id: 'u1', email: 'owner@example.com' } : null) }))
vi.mock('@/lib/meta/sync', () => ({
  syncMeta: async (store: string, opts: { deadlineAt?: number; requestTimeoutMs?: number }) => {
    h.calls.push({ store, opts })
    const a = h.answers[store] ?? { ok: true, skipped: [], accounts: [] }
    if (a instanceof Error) throw a
    return a
  },
}))

const { POST } = await import('./route')

beforeEach(() => { h.calls = []; h.answers = {}; h.signedIn = true })

describe('POST /api/sync/meta', () => {
  it('refuses without an allowed session and calls Meta for no store (the gate is not only the proxy)', async () => {
    h.signedIn = false
    const res = await POST()
    expect(res.status).toBe(401)
    expect(h.calls).toEqual([])
  })

  it('syncs every store under one shared 50 s budget', async () => {
    const before = Date.now()
    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, stores: [{ store: 'kaiven', ok: true }, { store: 'oorvia', ok: true }, { store: 'selnova', ok: true }] })
    expect(h.calls.map((c) => c.store)).toEqual(['kaiven', 'oorvia', 'selnova'])
    const deadlines = new Set(h.calls.map((c) => c.opts.deadlineAt))
    expect(deadlines.size).toBe(1)
    const [deadline] = deadlines
    expect(deadline! - before).toBeGreaterThanOrEqual(50_000)
    expect(deadline! - before).toBeLessThan(51_000)
    expect(h.calls.every((c) => c.opts.requestTimeoutMs === 20_000)).toBe(true)
  })

  it('keeps going after a store throws, and answers 500 with that error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.answers.kaiven = new Error('META_ACCESS_TOKEN_KAIVEN is not set')
    const res = await POST()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(h.calls.map((c) => c.store)).toEqual(['kaiven', 'oorvia', 'selnova'])
    expect(body.ok).toBe(false)
    expect(body.stores[0]).toEqual({ store: 'kaiven', ok: false, error: 'META_ACCESS_TOKEN_KAIVEN is not set' })
    expect(body.stores.slice(1).map((s: { ok: boolean }) => s.ok)).toEqual([true, true])
  })

  it('answers 200 but ok:false when a store finished with a problem', async () => {
    h.answers.selnova = { ok: false, skipped: ['Selnova1 (959242917044218): no access'], accounts: [{ status: 'no_access' }] }
    const res = await POST()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.stores[2]).toMatchObject({ store: 'selnova', ok: false, result: { skipped: ['Selnova1 (959242917044218): no access'] } })
  })
})
