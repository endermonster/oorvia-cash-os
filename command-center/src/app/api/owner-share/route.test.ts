import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PnlLine, PnlResult } from '@/lib/pnl'

const h = vi.hoisted(() => ({ calls: [] as unknown[][], fail: false }))
const line = (netProfit: number, ownerShare: number | null) => ({ netProfit, ownerShare }) as PnlLine
vi.mock('@/lib/pnl-load', () => ({
  loadPnl: async (...args: unknown[]): Promise<PnlResult> => {
    h.calls.push(args)
    if (h.fail) throw new Error('db down')
    return {
      months: [
        { month: '2026-10', stores: {}, shared: { vfByHead: {}, fixed: {} }, vxp: line(1_000_000, 500_000) },
        { month: '2026-11', stores: {}, shared: { vfByHead: {}, fixed: {} }, vxp: line(-20_001, -10_001) },
      ],
      warnings: ['a', 'b'],
    }
  },
}))

const { GET } = await import('./route')
const call = (auth?: string) =>
  GET(new Request('https://x.test/api/owner-share', auth === undefined ? {} : { headers: { authorization: auth } }))

beforeEach(() => {
  h.calls = []
  h.fail = false
  vi.stubEnv('OWNER_SHARE_SECRET', 'share-s3cret')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-21T06:00:00Z'))
})
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

describe('GET /api/owner-share', () => {
  it('returns VXP net and the share per month, the current month marked in progress', async () => {
    const res = await call('Bearer share-s3cret')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      months: [
        { month: '2026-10', netProfitPaise: 1_000_000, sharePaise: 500_000, inProgress: false },
        { month: '2026-11', netProfitPaise: -20_001, sharePaise: -10_001, inProgress: true },
      ],
      asOf: '2026-11-21T06:00:00.000Z',
      warnings: 2,
    })
    expect(h.calls).toEqual([['2026-06', '2026-11', '2026-11-21']])
  })

  it('refuses no header, a wrong secret, or the secret without "Bearer", and loads nothing', async () => {
    for (const auth of [undefined, 'Bearer wrong', 'share-s3cret', 'Bearer share-s3cretX']) {
      expect((await call(auth)).status).toBe(401)
    }
    expect(h.calls).toEqual([])
  })

  it('fails closed when OWNER_SHARE_SECRET is unset or empty', async () => {
    vi.stubEnv('OWNER_SHARE_SECRET', '')
    expect((await call('Bearer ')).status).toBe(401)
    expect((await call('Bearer undefined')).status).toBe(401)
    expect(h.calls).toEqual([])
  })

  it('a failed load is a 500 without the database message', async () => {
    h.fail = true
    const res = await call('Bearer share-s3cret')
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('db down')
  })
})
