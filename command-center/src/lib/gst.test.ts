import { describe, expect, it } from 'vitest'
import { capitalSummary, type CapitalRow } from './capital'
import { computeGst, dueDates, type GstOrder } from './gst'

const order = (o: Partial<GstOrder>): GstOrder => ({
  storeId: 'oorvia', orderName: '#OV1', orderDate: '2026-11-02', payment: 'cod', gateways: [], totalPaise: 118000, state: 'Karnataka', deliveredOn: null, ...o,
})
const base = { orders: [], txns: [], spend: [], fixed: [], entries: [], seeds: [], stores: [{ id: 'oorvia', gatewayPct: 0.02 }], asOf: '2026-11-22', fromMonth: '2026-11' }

describe('computeGst: output tax', () => {
  it('taxes delivered orders in the delivery month, IGST out of state and CGST + SGST in Maharashtra', () => {
    const g = computeGst({
      ...base,
      fromMonth: '2026-10',
      orders: [
        order({ orderName: '#OV1', orderDate: '2026-10-28', deliveredOn: '2026-11-03' }),
        order({ orderName: '#OV2', state: 'Maharashtra', totalPaise: 118001, deliveredOn: '2026-11-04' }),
        order({ orderName: '#OV3', deliveredOn: null }), // not delivered: no output tax
      ],
    })
    const [oct, nov] = g.months
    expect(oct.output.total).toBe(0)
    expect(nov.output).toEqual({ igst: 18000, cgst: 9000, sgst: 9000, manual: 0, total: 36000, orders: 2 })
  })
})

describe('computeGst: input credit, RCM and the credit ledger', () => {
  it('adds vFulfill GST (credit notes back out), 18% of Meta spend and of the computed fees', () => {
    const g = computeGst({
      ...base,
      orders: [order({ payment: 'prepaid', gateways: ['razorpay'], totalPaise: 100000 })],
      txns: [
        { storeId: null, orderName: null, txnDate: '2026-11-05', head: 'Storage Charges', nature: 'debit', gstPaise: 1000 },
        { storeId: null, orderName: null, txnDate: '2026-11-06', head: 'Storage Charges', nature: 'credit', gstPaise: 200 },
        { storeId: null, orderName: null, txnDate: '2026-10-31', head: 'Storage Charges', nature: 'debit', gstPaise: 999 }, // October
      ],
      spend: [{ date: '2026-11-01', spendPaise: 100000 }],
    })
    expect(g.months).toHaveLength(1)
    expect(g.months[0].itc).toEqual({ vfulfill: 800, meta: 18000, checkout: 360, gateway: 360, rcm: 0, manual: 0, total: 19520 })
  })

  it('skips the computed checkout fee when vFulfill billed a real one', () => {
    const g = computeGst({
      ...base,
      orders: [order({})],
      txns: [{ storeId: 'oorvia', orderName: '#OV1', txnDate: '2026-11-05', head: 'Checkout Service Fee', nature: 'debit', gstPaise: 500 }],
    })
    expect(g.months[0].itc.checkout).toBe(0)
    expect(g.months[0].itc.vfulfill).toBe(500)
  })

  it('charges RCM on flagged fixed costs billed so far, payable in cash and claimed back as credit', () => {
    const shopify = { storeId: 'oorvia', name: 'Shopify plan', amountPaise: 199400, frequency: 'monthly' as const, startDate: '2026-04-30', endDate: null, gstInclusive: false, rcm: true }
    const chatgpt = { ...shopify, storeId: null, name: 'ChatGPT', amountPaise: 169407, startDate: '2026-11-05' }
    const notRcm = { ...chatgpt, name: 'Rent', rcm: false }
    const g = computeGst({ ...base, fixed: [shopify, chatgpt, notRcm] }) // Shopify bills on the 30th: not yet on the 22nd
    expect(g.months[0].rcm).toBe(30493)
    expect(g.months[0].itc.rcm).toBe(30493)
    expect(g.months[0].cash).toBe(30493)
    expect(g.months[0].closing).toBe(30493)
  })

  it('chains the credit ledger from the latest balance entered, paying in cash only what it cannot cover', () => {
    const g = computeGst({
      ...base,
      seeds: [{ month: '2026-08', balancePaise: 500000, note: null }, { month: '2026-09', balancePaise: 10000, note: null }],
      orders: [order({ deliveredOn: '2026-10-10' }), order({ orderName: '#OV2', deliveredOn: '2026-11-10' })],
      entries: [{ id: 1, month: '2026-10', kind: 'itc', source: 'Laptop', description: null, taxablePaise: 50000, rate: 18, gstPaise: 9000, note: null }],
    })
    expect(g.seed?.month).toBe('2026-09')
    const [oct, nov] = g.months
    expect(oct).toMatchObject({ month: '2026-10', opening: 10000, payable: 0, closing: 1000, partial: false, gstr1Due: '2026-11-11', gstr3bDue: '2026-11-20' })
    // Both orders were placed in November: their checkout fees' GST (2 × ₹4.25) is November credit.
    expect(nov).toMatchObject({ month: '2026-11', opening: 1000, payable: 16150, closing: 0, cash: 16150, partial: true })
  })

  it('ignores a balance entered for the month in progress and starts at 0 with none', () => {
    const g = computeGst({ ...base, seeds: [{ month: '2026-11', balancePaise: 99, note: null }] })
    expect(g.seed).toBeNull()
    expect(g.months.map((m) => [m.month, m.opening])).toEqual([['2026-11', 0]])
  })

  it('puts December due dates in January', () => {
    expect(dueDates('2026-12')).toEqual({ gstr1Due: '2027-01-11', gstr3bDue: '2027-01-20' })
  })
})

describe('capitalSummary', () => {
  const loan: CapitalRow = { id: 1, kind: 'loan', name: 'Laxman Khemani', amountPaise: 26500000, receivedOn: '2026-04-21', interestRate: 0, dueOn: '2026-05-31', repaidPaise: 0, note: null }
  it('counts what is owed, days overdue and simple interest on the full amount', () => {
    const s = capitalSummary([loan, { ...loan, id: 2, name: 'Bank', amountPaise: 3650000, receivedOn: '2026-11-12', interestRate: 0.1, dueOn: null, repaidPaise: 650000 }], '2026-11-22')
    expect(s.loans[0]).toMatchObject({ outstanding: 26500000, interest: 0, totalDue: 26500000, daysOverdue: 175 })
    expect(s.loans[1]).toMatchObject({ outstanding: 3000000, days: 10, interest: 10000, totalDue: 3010000, daysOverdue: null })
    expect(s.loanTotalDue).toBe(29510000)
  })
  it('a repaid loan owes nothing and is not overdue; partners add up by name', () => {
    const p = { ...loan, kind: 'partner' as const, interestRate: null, dueOn: null }
    const s = capitalSummary([{ ...loan, repaidPaise: 26500000 }, { ...p, id: 3, name: 'Vedaant', amountPaise: 100 }, { ...p, id: 4, name: 'Vedaant', amountPaise: 50 }], '2026-11-22')
    expect(s.loans[0]).toMatchObject({ settled: true, totalDue: 0, daysOverdue: null })
    expect(s.partners).toEqual([expect.objectContaining({ name: 'Vedaant', amount: 150, outstanding: 150 })])
  })
})
