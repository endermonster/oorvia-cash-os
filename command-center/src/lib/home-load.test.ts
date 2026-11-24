import { describe, expect, it, vi } from 'vitest'
import { computeGst, type GstEntry } from './gst'
import { loadGst } from './gst-load'
import { loadHomeExtras, mapGstPosition, mapOwnerShareMonth } from './home-load'
import { computePnl } from './pnl'
import { loadPnl } from './pnl-load'

vi.mock('server-only', () => ({}))
vi.mock('./gst-load', () => ({ loadGst: vi.fn() }))
vi.mock('./pnl-load', () => ({ loadPnl: vi.fn() }))
// The cache itself runs only inside Next: here the wrappers call the mocked loaders straight through.
vi.mock('./cached', async () => {
  const [g, p] = await Promise.all([import('./gst-load'), import('./pnl-load')])
  return { cachedGst: (today: string) => g.loadGst(today), cachedPnl: (from: string, to: string, asOf?: string) => p.loadPnl(from, to, asOf) }
})

const today = '2026-11-22'
const month = '2026-11'
const rcm = (id: number, month: string, gstPaise: number): GstEntry => ({
  id, month, gstPaise, kind: 'rcm', source: 'shopify', description: null, taxablePaise: 0, rate: 0.18, note: null,
})
const gst = computeGst({
  orders: [], txns: [], spend: [], fixed: [], seeds: [], stores: [],
  entries: [rcm(1, '2026-10', 30_529), rcm(2, month, 9_086)], asOf: today, fromMonth: '2026-10',
})
const nextGst = { month: '2026-10', cash: 305.29, dueDate: '2026-11-20', partial: false }

const pnlInput: Parameters<typeof computePnl>[0] = {
  stores: [{ id: 'oorvia', gatewayPct: 0.02, ownerShare: 0.5 }],
  orders: [{
    storeId: 'oorvia', orderName: '#1', orderDate: '2026-10-29', payment: 'cod', gateways: [], totalPaise: 118_000,
    cancelled: false, shipStatus: 'delivered', closedOn: '2026-11-02', cogsPaise: 35_001, cogsKnown: true,
  }],
  txns: [{ storeId: 'oorvia', orderName: '#1', txnDate: '2026-10-30', head: 'Forward Shipping', nature: 'debit', taxablePaise: 6_001, totalPaise: 7_081 }],
  spend: [{ storeId: 'oorvia', date: '2026-11-08', spendPaise: 18_500 }],
  fixed: [{
    storeId: null, name: 'vFulfill subscription', amountPaise: 90_000, frequency: 'quarterly', startDate: '2026-08-01', endDate: null, gstInclusive: false,
  }],
  fromMonth: month, toMonth: month, asOf: today,
}
const pnl = computePnl(pnlInput)
const currentShare = { month, net: -518.62, share: -259.31 }

describe('mapGstPosition', () => {
  it('uses the first month’s cash in rupees and its GSTR-3B due date', () => {
    expect(mapGstPosition(gst)).toEqual(nextGst)
    expect(mapGstPosition({ ...gst, months: gst.months.slice(1) })).toEqual({ month, cash: 90.86, dueDate: '2026-12-20', partial: true })
  })

  it('returns null when there are no months', () => {
    expect(mapGstPosition({ seed: null, months: [] })).toBeNull()
  })
})

describe('mapOwnerShareMonth', () => {
  it('matches Money’s current-month VXP P&L in rupees, even with an order placed in an earlier month', () => {
    const money = computePnl({ ...pnlInput, fromMonth: '2026-08' })
    expect(mapOwnerShareMonth(money, month)).toEqual(currentShare)
    expect(mapOwnerShareMonth(pnl, month)).toEqual(currentShare)
  })

  it('preserves a null share and returns null for a missing month', () => {
    const mixedShares = computePnl({ ...pnlInput, stores: [...pnlInput.stores, { id: 'kaiven', gatewayPct: 0.02, ownerShare: 0.25 }] })
    expect(mapOwnerShareMonth(mixedShares, month)).toEqual({ ...currentShare, share: null })
    expect(mapOwnerShareMonth(pnl, '2026-10')).toBeNull()
  })
})

describe('loadHomeExtras', () => {
  it('returns the owner share if GST fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      vi.mocked(loadGst).mockRejectedValueOnce(new Error('GST unavailable'))
      vi.mocked(loadPnl).mockResolvedValueOnce(pnl)
      expect(await loadHomeExtras(today)).toEqual({ gst: null, ownerShareMonth: currentShare })
      expect(loadGst).toHaveBeenCalledWith(today)
      expect(loadPnl).toHaveBeenCalledWith(month, month, today)
      expect(log).toHaveBeenCalledWith('home gst: GST unavailable')
    } finally {
      log.mockRestore()
    }
  })

  it('returns GST if the P&L fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      vi.mocked(loadGst).mockResolvedValueOnce(gst)
      vi.mocked(loadPnl).mockRejectedValueOnce('P&L unavailable')
      expect(await loadHomeExtras(today)).toEqual({ gst: nextGst, ownerShareMonth: null })
      expect(log).toHaveBeenCalledWith('home pnl: P&L unavailable')
    } finally {
      log.mockRestore()
    }
  })
})
