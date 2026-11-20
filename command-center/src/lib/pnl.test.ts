import { describe, expect, it } from 'vitest'
import { addMonths, computePnl, fixedInMonth, gatewayRate, orderCogs, type FixedCost, type PnlOrder, type PnlTxn } from './pnl'

const stores = [
  { id: 'oorvia', gatewayPct: 0.02, ownerShare: 0.5 },
  { id: 'kaiven', gatewayPct: 0.02, ownerShare: 0.5 },
]
const order = (o: Partial<PnlOrder>): PnlOrder => ({
  storeId: 'oorvia', orderName: '#OV1', orderDate: '2026-05-10', payment: 'cod', gateways: [], totalPaise: 118_000,
  cancelled: false, shipStatus: 'delivered', closedOn: '2026-05-14', cogsPaise: 30_000, cogsKnown: true, ...o,
})
const txn = (t: Partial<PnlTxn>): PnlTxn => ({
  storeId: 'oorvia', orderName: '#OV1', txnDate: '2026-05-11', head: 'Forward Shipping', nature: 'debit', taxablePaise: 5_000, totalPaise: 5_900, ...t,
})
const run = (p: Partial<Parameters<typeof computePnl>[0]>) =>
  computePnl({ stores, orders: [], txns: [], spend: [], fixed: [], fromMonth: '2026-04', toMonth: '2026-06', ...p })
const month = (r: ReturnType<typeof run>, m: string) => r.months.find((x) => x.month === m)!

describe('computePnl: orders', () => {
  it('a delivered order earns ex-GST revenue and carries COGS in its delivery month, not its order month', () => {
    const r = run({ orders: [order({ orderDate: '2026-04-29', closedOn: '2026-05-02' })] })
    expect(month(r, '2026-04').stores.oorvia.revenueNet).toBe(0)
    const may = month(r, '2026-05').stores.oorvia
    expect(may.orders.delivered).toBe(1)
    expect(may.revenueGross).toBe(118_000)
    expect(may.revenueNet).toBe(100_000)
    expect(may.cogs).toBe(30_000)
  })

  it('an RTO order earns nothing and has no COGS, in its order month, but its fees count', () => {
    const o = order({ orderDate: '2026-04-20', shipStatus: 'rto', closedOn: '2026-05-05' })
    const r = run({ orders: [o], txns: [txn({ head: 'RTO Shipping', taxablePaise: 4_000 })] })
    const apr = month(r, '2026-04').stores.oorvia
    expect(apr.orders.rto).toBe(1)
    expect(apr.revenueNet).toBe(0)
    expect(apr.cogs).toBe(0)
    expect(apr.vfByHead['RTO Shipping']).toBe(4_000)
    expect(apr.checkoutFees).toBe(2_360) // 2% of ₹1,180
    expect(apr.netProfit).toBe(-6_360)
  })

  it('a cancelled order earns nothing but still pays the checkout fee', () => {
    const r = run({ orders: [order({ cancelled: true, shipStatus: null, closedOn: null })] })
    const may = month(r, '2026-05').stores.oorvia
    expect(may.orders.cancelled).toBe(1)
    expect(may.revenueNet).toBe(0)
    expect(may.checkoutFees).toBe(2_360)
  })

  it('the shipment decides: an RTO that Shopify marked cancelled is an RTO', () => {
    const r = run({ orders: [order({ cancelled: true, shipStatus: 'rto' })] })
    const may = month(r, '2026-05').stores.oorvia
    expect(may.orders.rto).toBe(1)
    expect(may.orders.cancelled).toBe(0)
  })

  it('a COD remittance on an order the export still shows open makes it delivered, on the remittance date', () => {
    const r = run({
      orders: [order({ orderDate: '2026-05-29', shipStatus: 'open', closedOn: null })],
      txns: [txn({ head: 'COD Remittance', nature: 'credit', txnDate: '2026-06-01', taxablePaise: null, totalPaise: 118_000 })],
    })
    expect(month(r, '2026-05').stores.oorvia.orders.open).toBe(0)
    const jun = month(r, '2026-06').stores.oorvia
    expect(jun.orders.delivered).toBe(1)
    expect(jun.revenueNet).toBe(100_000)
    expect(r.warnings.join()).toMatch(/1 order counted delivered because vFulfill remitted.*#OV1/)
  })

  it('a remittance never overrides an RTO, and a delivered shipment keeps its own date', () => {
    const cash = txn({ head: 'COD Remittance', nature: 'credit', txnDate: '2026-06-20', taxablePaise: null, totalPaise: 118_000 })
    const rto = run({ orders: [order({ shipStatus: 'rto' })], txns: [cash] })
    expect(month(rto, '2026-05').stores.oorvia.orders.rto).toBe(1)
    const del = run({ orders: [order({})], txns: [cash] })
    expect(month(del, '2026-05').stores.oorvia.orders.delivered).toBe(1)
    expect(del.warnings).toEqual([])
  })

  it('leaves out orders placed before the store went live', () => {
    const r = computePnl({
      stores: [{ ...stores[0], liveSince: '2026-03-21' }], txns: [], spend: [], fixed: [], fromMonth: '2026-03', toMonth: '2026-03',
      orders: [order({ orderName: '#OV1', orderDate: '2026-03-20', shipStatus: null, closedOn: null }), order({ orderName: '#OV2', orderDate: '2026-03-21', shipStatus: null, closedOn: null })],
    })
    expect(r.months[0].stores.oorvia.orders.open).toBe(1)
  })

  it('an order with no shipment yet is open, in its order month', () => {
    const r = run({ orders: [order({ shipStatus: null, closedOn: null })] })
    expect(month(r, '2026-05').stores.oorvia.orders.open).toBe(1)
  })

  it('gateway fees on prepaid only: Cashfree at 2.5%, others at the store rate', () => {
    expect(gatewayRate(['Cashfree'], 0.02)).toBe(0.025)
    expect(gatewayRate(['1Cashfree Payments(UPI,Cards,Net Banking,Wallets)'], 0.02)).toBe(0.025)
    expect(gatewayRate(['PayU'], 0.02)).toBe(0.02)
    const r = run({
      orders: [
        order({ orderName: '#OV1', payment: 'prepaid', gateways: ['Cashfree'] }),
        order({ orderName: '#OV2', payment: 'cod' }),
        order({ orderName: '#OV3', payment: 'unknown' }),
        order({ storeId: 'kaiven', orderName: '#KAI1', payment: 'prepaid', gateways: ['PayU'] }),
      ],
    })
    const may = month(r, '2026-05')
    expect(may.stores.oorvia.gatewayFees).toBe(2_950)
    expect(may.stores.kaiven.gatewayFees).toBe(2_360)
  })

  it('warns when a delivered order has a product with no cost', () => {
    const r = run({ orders: [order({ cogsKnown: false, cogsPaise: 0 })] })
    expect(month(r, '2026-05').stores.oorvia.cogsMissing).toBe(1)
    expect(r.warnings.join()).toMatch(/1 delivered order with a product that has no cost/)
  })
})

describe('computePnl: vFulfill ledger', () => {
  it('books an order charge in the order month, whatever date it was charged', () => {
    const r = run({ orders: [order({ orderDate: '2026-04-28', closedOn: '2026-05-03' })], txns: [txn({ txnDate: '2026-06-01' })] })
    expect(month(r, '2026-05').stores.oorvia.vfByHead['Forward Shipping']).toBe(5_000)
    expect(month(r, '2026-06').stores.oorvia.vfFees).toBe(0)
  })

  it('takes GST out when a row has no taxable amount', () => {
    const r = run({ orders: [order({})], txns: [txn({ taxablePaise: null, totalPaise: 1_180 })] })
    expect(month(r, '2026-05').stores.oorvia.vfFees).toBe(1_000)
  })

  it('ignores COD remittances, top-ups, withdrawals and stock purchases', () => {
    const r = run({
      orders: [order({})],
      txns: [
        txn({ head: 'COD Remittance', nature: 'credit', taxablePaise: 118_000 }),
        txn({ storeId: null, orderName: null, head: 'Client Sourcing Request', taxablePaise: 9_000_000 }),
        txn({ storeId: null, orderName: null, head: 'Add Funds - Wire', nature: 'credit', taxablePaise: 100_000 }),
        txn({ storeId: null, orderName: null, head: 'Withdraw Funds', taxablePaise: 100_000 }),
      ],
    })
    const may = month(r, '2026-05')
    expect(may.stores.oorvia.vfFees).toBe(0)
    expect(may.vxp.vfFees).toBe(0)
  })

  it('a billed checkout fee replaces the computed 2%, on the checkout line (Codex review)', () => {
    const r = run({ orders: [order({})], txns: [txn({ head: 'Checkout Service Fee', taxablePaise: 2_000 })] })
    const may = month(r, '2026-05').stores.oorvia
    expect(may.checkoutFees).toBe(2_000)
    expect(may.vfFees).toBe(0)
  })

  it("a pre-tracking order's charges are left out with it, not booked as unmatched (Codex review)", () => {
    const r = computePnl({
      stores: [{ ...stores[0], liveSince: '2026-03-21' }], spend: [], fixed: [], fromMonth: '2026-03', toMonth: '2026-04',
      orders: [order({ orderDate: '2026-03-20', closedOn: '2026-03-25' })],
      txns: [txn({ txnDate: '2026-04-02' })],
    })
    expect(r.months.map((m) => m.vxp.vfFees)).toEqual([0, 0])
    expect(r.warnings).toEqual([])
  })

  it('a Lost Claims credit reduces vFulfill fees', () => {
    const r = run({ orders: [order({})], txns: [txn({}), txn({ head: 'Lost Claims', nature: 'credit', taxablePaise: 2_000 })] })
    expect(month(r, '2026-05').stores.oorvia.vfFees).toBe(3_000)
  })

  it('storage and other wallet charges go to the VXP total only', () => {
    const r = run({ txns: [txn({ storeId: null, orderName: null, head: 'Storage Charges', taxablePaise: 700 })] })
    const may = month(r, '2026-05')
    expect(may.stores.oorvia.vfFees).toBe(0)
    expect(may.shared.vfByHead['Storage Charges']).toBe(700)
    expect(may.vxp.vfFees).toBe(700)
    expect(may.vxp.netProfit).toBe(-700)
  })

  it('spreads a subscription over the quarter starting with its month', () => {
    const r = computePnl({
      stores, orders: [], spend: [], fixed: [], fromMonth: '2026-10', toMonth: '2027-01',
      txns: [txn({ storeId: null, orderName: null, head: 'Subscription Charge', txnDate: '2026-10-27', taxablePaise: 5_000_000 })],
    })
    expect(r.months.map((m) => m.vxp.vfFees)).toEqual([1_666_667, 1_666_667, 1_666_667, 0])
  })

  it('a charge for an order not in Shopify data counts in the month charged, with a warning', () => {
    const r = run({ txns: [txn({ orderName: '#OV999', txnDate: '2026-06-03' })] })
    expect(month(r, '2026-06').stores.oorvia.vfFees).toBe(5_000)
    expect(r.warnings.join()).toMatch(/1 vFulfill charge for orders not in Shopify/)
  })

  it('a head nobody has seen is counted as a shared cost and named', () => {
    const r = run({ txns: [txn({ storeId: null, orderName: null, head: 'Penalty', taxablePaise: 100 })] })
    expect(month(r, '2026-05').vxp.vfFees).toBe(100)
    expect(r.warnings.join()).toMatch(/"Penalty"/)
  })
})

describe('orderCogs', () => {
  const hist = [
    { store_id: 'oorvia', sku: 'YB31', cogs_paise: 31_100, effective_from: '2025-11-01' },
    { store_id: 'oorvia', sku: 'YB31', cogs_paise: 33_200, effective_from: '2026-05-20' },
  ]
  const line = (o: string, sku: string | null, qty = 1, pid: string | null = null) => ({ store_id: 'oorvia', order_name: o, sku, qty, shopify_product_id: pid })

  it('uses the cost in force on the order date, for every line', () => {
    const c = orderCogs(
      [{ storeId: 'oorvia', orderName: '#A', date: '2026-05-19' }, { storeId: 'oorvia', orderName: '#B', date: '2026-05-20' }],
      [line('#A', 'YB31', 2), line('#B', 'YB31')], hist,
    )
    expect(c.get('oorvia|#A')).toEqual({ cogsPaise: 62_200, cogsKnown: true })
    expect(c.get('oorvia|#B')).toEqual({ cogsPaise: 33_200, cogsKnown: true })
  })

  it('a product line with no cost makes the order unknown; a non-product line is ignored', () => {
    const c = orderCogs(
      [{ storeId: 'oorvia', orderName: '#A', date: '2026-06-01' }],
      [line('#A', 'YB31'), line('#A', 'NEW'), line('#A', null, 1, 'gid://shopify/Product/9'), line('#A', null)], hist,
    )
    expect(c.get('oorvia|#A')).toEqual({ cogsPaise: 33_200, cogsKnown: false })
  })
})

describe('computePnl: spend, fixed costs, totals', () => {
  it('ad spend lands in its store and month', () => {
    const r = run({ spend: [{ storeId: 'kaiven', date: '2026-06-30', spendPaise: 50_000 }] })
    expect(month(r, '2026-06').stores.kaiven.adSpend).toBe(50_000)
    expect(month(r, '2026-06').vxp.adSpend).toBe(50_000)
  })

  it('a store fixed cost sits on that store; a shared one on VXP only', () => {
    const fixed: FixedCost[] = [
      { storeId: 'oorvia', name: 'Shopify Oorvia', amountPaise: 199_400, frequency: 'monthly', startDate: '2026-04-01', endDate: null, gstInclusive: false },
      { storeId: null, name: 'Tools', amountPaise: 31_000, frequency: 'monthly', startDate: '2026-04-01', endDate: null, gstInclusive: false },
    ]
    const may = month(run({ fixed }), '2026-05')
    expect(may.stores.oorvia.fixedCosts).toBe(199_400)
    expect(may.stores.kaiven.fixedCosts).toBe(0)
    expect(may.shared.fixed.Tools).toBe(31_000)
    expect(may.vxp.fixedCosts).toBe(230_400)
  })

  it('books a monthly cost whole on its billing day, each month from start to end', () => {
    const fc: FixedCost = { storeId: 'kaiven', name: 'Shopify trial', amountPaise: 2_000, frequency: 'monthly', startDate: '2026-11-10', endDate: '2027-02-09', gstInclusive: false }
    // Billed 10 Nov, 10 Dec, 10 Jan: three months of the offer. 10 Feb is past the end.
    expect(['2026-10', '2026-11', '2026-12', '2027-01', '2027-02'].map((m) => fixedInMonth(fc, m))).toEqual([0, 2_000, 2_000, 2_000, 0])
    expect(fixedInMonth({ ...fc, frequency: 'one-time' }, '2026-11')).toBe(2_000)
    expect(fixedInMonth({ ...fc, frequency: 'one-time' }, '2026-12')).toBe(0)
    expect(fixedInMonth({ ...fc, gstInclusive: true, startDate: '2026-12-01' }, '2026-12')).toBeCloseTo(2_000 / 1.18)
  })

  it('a cost billed on the 30th lands on the last day of a shorter month', () => {
    const fc: FixedCost = { storeId: 'oorvia', name: 'Shopify plan', amountPaise: 199_400, frequency: 'monthly', startDate: '2026-04-30', endDate: null, gstInclusive: false }
    expect(fixedInMonth(fc, '2027-02', '2027-02-28')).toBe(199_400)
    expect(fixedInMonth(fc, '2027-02', '2027-02-27')).toBe(0)
    expect(fixedInMonth(fc, '2026-04')).toBe(199_400) // first bill, on its start date
    expect(fixedInMonth(fc, '2026-03')).toBe(0)
  })

  it('a month in progress shows only bills already due: nothing before the billing day, all of it on it', () => {
    const fc: FixedCost = { storeId: 'oorvia', name: 'Shopify plan', amountPaise: 199_400, frequency: 'monthly', startDate: '2026-04-30', endDate: null, gstInclusive: false }
    expect(fixedInMonth(fc, '2026-11', '2026-11-20')).toBe(0)
    expect(fixedInMonth(fc, '2026-11', '2026-11-30')).toBe(199_400)
    expect(fixedInMonth(fc, '2026-10', '2026-11-20')).toBe(199_400)
    expect(fixedInMonth({ ...fc, frequency: 'one-time', startDate: '2026-11-25' }, '2026-11', '2026-11-20')).toBe(0)
    expect(fixedInMonth({ ...fc, frequency: 'one-time', startDate: '2026-11-05' }, '2026-11', '2026-11-20')).toBe(199_400)
    const r = computePnl({ stores, orders: [], txns: [], spend: [], fixed: [{ ...fc, startDate: '2026-11-10' }], fromMonth: '2026-11', toMonth: '2026-11', asOf: '2026-11-20' })
    expect(r.months[0].stores.oorvia.fixedCosts).toBe(199_400)
  })

  it('each subscription third lands on its monthly date, and not before', () => {
    const sub = txn({ storeId: null, orderName: null, head: 'Subscription Charge', txnDate: '2026-10-27', taxablePaise: 3_000_000 })
    const run3 = (asOf: string) => computePnl({ stores, orders: [], spend: [], fixed: [], txns: [sub], fromMonth: '2026-10', toMonth: '2026-12', asOf })
    expect(run3('2026-11-20').months.map((m) => m.vxp.vfFees)).toEqual([1_000_000, 0, 0])
    expect(run3('2026-11-27').months.map((m) => m.vxp.vfFees)).toEqual([1_000_000, 1_000_000, 0])
  })

  it('net profit adds up from the rounded lines, and the owner share is half', () => {
    const r = run({
      orders: [order({ payment: 'prepaid', gateways: ['Cashfree'] })],
      txns: [txn({})],
      spend: [{ storeId: 'oorvia', date: '2026-05-01', spendPaise: 20_000 }],
    })
    const l = month(r, '2026-05').stores.oorvia
    expect(l.netProfit).toBe(100_000 - 30_000 - 5_000 - 2_360 - 2_950 - 20_000)
    expect(l.ownerShare).toBe(l.netProfit / 2)
    expect(month(r, '2026-05').vxp.netProfit).toBe(l.netProfit)
  })

  it('VXP owner share is null when stores are split differently', () => {
    const r = computePnl({ stores: [stores[0], { ...stores[1], ownerShare: 0.4 }], orders: [], txns: [], spend: [], fixed: [], fromMonth: '2026-05', toMonth: '2026-05' })
    expect(r.months[0].vxp.ownerShare).toBeNull()
  })

  it('lists every month in range, empty ones included, and leaves out unknown stores with a warning', () => {
    const r = run({ spend: [{ storeId: 'avesto', date: '2026-05-01', spendPaise: 1 }] })
    expect(r.months.map((m) => m.month)).toEqual(['2026-04', '2026-05', '2026-06'])
    expect(r.warnings.join()).toMatch(/unknown store "avesto"/)
    expect(addMonths('2026-12', 1)).toBe('2027-01')
  })
})
