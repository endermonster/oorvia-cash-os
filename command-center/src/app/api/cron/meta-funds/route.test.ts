import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ calls: [] as boolean[] }))
vi.mock('@/lib/meta/funds', () => ({
  checkFunds: async ({ dryRun }: { dryRun: boolean }) => {
    h.calls.push(dryRun)
    return { dry_run: dryRun, ok: true, accounts: [] }
  },
}))

const { GET } = await import('./route')
const call = (auth?: string, query = '') =>
  GET(new Request(`https://x.test/api/cron/meta-funds${query}`, auth === undefined ? {} : { headers: { authorization: auth } }))

beforeEach(() => { h.calls = []; vi.stubEnv('FUNDS_CRON_SECRET', 'f-secret'); vi.stubEnv('CRON_SECRET', 'other') })
afterEach(() => { vi.unstubAllEnvs() })

describe('GET /api/cron/meta-funds', () => {
  it('checks funds with the right bearer; ?dry=1 is a dry run', async () => {
    expect((await call('Bearer f-secret')).status).toBe(200)
    expect((await call('Bearer f-secret', '?dry=1')).status).toBe(200)
    expect(h.calls).toEqual([false, true])
  })

  it('refuses a missing or wrong secret, including the Meta cron secret', async () => {
    for (const auth of [undefined, 'Bearer other', 'f-secret', 'Bearer f-secretX']) expect((await call(auth)).status).toBe(401)
    expect(h.calls).toEqual([])
  })

  it('fails closed when FUNDS_CRON_SECRET is unset', async () => {
    vi.stubEnv('FUNDS_CRON_SECRET', '')
    expect((await call('Bearer ')).status).toBe(401)
    expect(h.calls).toEqual([])
  })
})
