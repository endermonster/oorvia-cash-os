import { describe, expect, it } from 'vitest'
import { balanceOf, exactOf, mapTransactions, paiseOf, transactionsComplete } from './transactions'

const STORES = [{ id: 'oorvia', order_prefix: '#OV' }, { id: 'kaiven', order_prefix: '#KAI' }]
const tx = (r: Record<string, string>) => ({
  'Transaction ID': 'VFTN1', 'Transaction Date': '2026-08-10', 'Transaction Head': 'Fulfilment Fees', 'Transaction Nature': 'Debit',
  'Transaction Status': 'Processed', 'Taxable Amt': '28', 'GST Amt': '5.04', 'Total Amt': '33.04', 'Shopify Order Name': '#OV1',
  'VF Order ID': 'VFOD1', 'Particulars': '-', 'Remarks': '-', 'Payment Type': 'Prepaid', ...r,
})

describe('paiseOf', () => {
  it('rounds to paise, blank is null, junk throws', () => {
    expect(paiseOf('68.1686')).toBe(6817)
    expect(paiseOf('50000.0102')).toBe(5000001)
    expect(paiseOf('1,399')).toBe(139900)
    expect([paiseOf('-'), paiseOf('')]).toEqual([null, null])
    expect(() => paiseOf('abc')).toThrow()
  })
})

describe('mapTransactions', () => {
  it('maps an order fee with its store from the order prefix', () => {
    const { rows } = mapTransactions([tx({})], STORES)
    expect(rows).toEqual([{
      txn_id: 'VFTN1', txn_date: '2026-08-10', store_id: 'oorvia', order_name: '#OV1', vf_order_id: 'VFOD1', head: 'Fulfilment Fees',
      nature: 'debit', taxable_paise: 2800, gst_paise: 504, total_paise: 3304, total_exact: '33.04', particulars: null, remarks: null,
    }])
  })

  it('a wallet row has no order and no store', () => {
    const { rows } = mapTransactions([tx({ 'Transaction ID': 'VFTN2', 'Transaction Head': 'Add Funds - Wire', 'Transaction Nature': 'Credit', 'Total Amt': '10000', 'Shopify Order Name': '-', 'VF Order ID': '-' })], STORES)
    expect(rows[0]).toMatchObject({ store_id: null, order_name: null, nature: 'credit', total_paise: 1000000 })
  })

  it('skips the extra item line of a multi-product order, and declined rows', () => {
    const { rows, report } = mapTransactions([
      tx({}),
      tx({ 'Total Amt': '-', 'Taxable Amt': '-', 'GST Amt': '-', 'Transaction Nature': '-', 'Transaction Status': '-' }),
      tx({ 'Transaction ID': 'VFTN3', 'Transaction Head': 'Add Funds - Wire', 'Transaction Status': 'Declined', 'Total Amt': '5000', 'Shopify Order Name': '-' }),
    ], STORES)
    expect(rows).toHaveLength(1)
    expect(report.itemLines).toBe(1)
    expect(report.declined).toEqual({ count: 1, paise: 500000 })
  })

  it('keeps an unknown head (the balance must stay complete) but reports it', () => {
    const { rows, report } = mapTransactions([tx({ 'Transaction Head': 'Mystery Charge' })], STORES)
    expect(rows).toHaveLength(1)
    expect(report.unknownHeads).toEqual({ 'Mystery Charge': 1 })
  })

  it('reports an order name with no store, an unknown status, and refuses a conflicting duplicate', () => {
    const { report } = mapTransactions([tx({ 'Shopify Order Name': '#1001' }), tx({ 'Transaction ID': 'VFTN4', 'Transaction Status': 'Pending' })], STORES)
    expect(report.noStore).toEqual(['#1001'])
    expect(report.otherStatus).toEqual({ Pending: 1 })
    expect(() => mapTransactions([tx({}), tx({ 'Total Amt': '40' })], STORES)).toThrow(/listed twice/)
  })

  it('refuses a file that is not a transactions export', () => {
    expect(() => mapTransactions([{ 'Shopify Order name': '#OV1' }], STORES)).toThrow(/not a vFulfill transactions export/)
  })

  it('balance is credits minus debits', () => {
    const { rows } = mapTransactions([
      tx({ 'Transaction ID': 'A', 'Transaction Head': 'Add Funds - Wire', 'Transaction Nature': 'Credit', 'Total Amt': '1000', 'Shopify Order Name': '-' }),
      tx({ 'Transaction ID': 'B' }),
      tx({ 'Transaction ID': 'C', 'Transaction Head': 'COD Remittance', 'Transaction Nature': 'Credit', 'Total Amt': '1399' }),
    ], STORES)
    expect(balanceOf(rows)).toBe(100000 - 3304 + 139900)
  })

  it('balance sums exact amounts and rounds once: per-row rounding would be 2 paise off here', () => {
    const fee = (id: string) => tx({ 'Transaction ID': id, 'Transaction Head': 'COD Fees', 'Total Amt': '0.00498' })
    const { rows } = mapTransactions([fee('A'), fee('B'), fee('C'), fee('D'), fee('E')], STORES)
    expect(rows.reduce((s, r) => s - r.total_paise, 0)).toBe(0) // each rounds to 0 paise
    expect(balanceOf(rows)).toBe(-2) // 5 × ₹0.00498 = ₹0.0249
  })
})

describe('exactOf', () => {
  it('normalises without losing digits', () => {
    expect(exactOf('68.1686')).toBe('68.1686')
    expect(exactOf('1,399')).toBe('1399')
    expect(exactOf('068.10')).toBe('68.1')
    expect(exactOf('50000.01020')).toBe('50000.0102')
    expect(() => exactOf('1.1234567')).toThrow()
    expect(() => exactOf('-5')).toThrow()
  })
})

describe('transactionsComplete', () => {
  it('rows skipped for an unknown status, or nothing written, is not a complete import', () => {
    const ok = mapTransactions([tx({})], STORES)
    expect(transactionsComplete(ok.report, ok.rows.length)).toBe(true)
    const odd = mapTransactions([tx({}), tx({ 'Transaction ID': 'VFTN9', 'Transaction Status': 'Pending' })], STORES)
    expect(transactionsComplete(odd.report, odd.rows.length)).toBe(false)
    expect(transactionsComplete(ok.report, 0)).toBe(false)
  })
})
