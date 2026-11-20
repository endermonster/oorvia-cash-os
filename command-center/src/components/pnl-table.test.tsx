import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { computePnl } from '@/lib/pnl'
import { PnlTable } from './PnlTable'

const pnl = computePnl({
  stores: [{ id: 'oorvia', gatewayPct: 0.02, ownerShare: 0.5 }],
  orders: [{
    storeId: 'oorvia', orderName: '#OV1', orderDate: '2026-10-10', payment: 'cod', gateways: [], totalPaise: 118_000,
    cancelled: false, shipStatus: 'delivered', closedOn: '2026-10-14', cogsPaise: 30_000, cogsKnown: true,
  }],
  txns: [{ storeId: null, orderName: null, txnDate: '2026-11-02', head: 'Storage Charges', nature: 'debit', taxablePaise: 2_000, totalPaise: 2_360 }],
  spend: [], fixed: [], fromMonth: '2026-10', toMonth: '2026-11',
})

describe('PnlTable', () => {
  it('newest month first, marked to date, with net profit and the 50% share', () => {
    const html = renderToStaticMarkup(<PnlTable pnl={pnl} store={null} storeName="All VXP" currentMonth="2026-11" />)
    expect(html.indexOf('Nov 2026')).toBeLessThan(html.indexOf('Oct 2026'))
    expect(html).toContain('to date')
    expect(html).toContain('₹1,000') // Oct revenue ex-GST
    expect(html).toContain('₹676') // Oct net: 1,000 − 300 − 23.60 checkout
    expect(html).toContain('₹338') // its 50%
    expect(html).toContain('Storage Charges: ₹20') // Nov shared cost note
  })

  it('a store view says shared costs are left out, and shows warnings', () => {
    const html = renderToStaticMarkup(<PnlTable pnl={{ ...pnl, warnings: ['3 orders counted delivered'] }} store="oorvia" storeName="Oorvia" currentMonth="2026-11" />)
    expect(html).toContain('Monthly P&amp;L · Oorvia')
    expect(html).toContain('All VXP view only')
    expect(html).not.toContain('Shared costs this month')
    expect(html).toContain('3 orders counted delivered')
  })
})
