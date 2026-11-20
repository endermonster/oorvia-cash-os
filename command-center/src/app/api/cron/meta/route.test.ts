import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock('@/lib/meta/sync', () => ({
  syncMeta: async (store: string) => {
    h.calls.push(store)
    return { ok: true, skipped: [], accounts: [] }
  },
}))

const { GET } = await import('./route')
const call = (auth?: string) =>
  GET(new Request('https://x.test/api/cron/meta', auth === undefined ? {} : { headers: { authorization: auth } }))

beforeEach(() => { h.calls = []; vi.stubEnv('CRON_SECRET', 's3cret-value') })
afterEach(() => { vi.unstubAllEnvs() })

describe('GET /api/cron/meta', () => {
  it('syncs every store with the right bearer', async () => {
    const res = await call('Bearer s3cret-value')
    expect(res.status).toBe(200)
    expect(h.calls).toEqual(['kaiven', 'oorvia', 'selnova'])
  })

  it('refuses no header, a wrong secret, or the secret without "Bearer", and calls Meta for no store', async () => {
    for (const auth of [undefined, 'Bearer wrong', 's3cret-value', 'Bearer s3cret-valueX', 'bearer s3cret-value']) {
      expect((await call(auth)).status).toBe(401)
    }
    expect(h.calls).toEqual([])
  })

  it('fails closed when CRON_SECRET is unset or empty', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await call('Bearer ')).status).toBe(401)
    expect((await call('Bearer undefined')).status).toBe(401)
    expect(h.calls).toEqual([])
  })
})
