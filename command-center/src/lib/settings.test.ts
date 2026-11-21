import { describe, expect, it } from 'vitest'
import { isoDate, isoMonth, parseBank, parseCapital, parseCogs, parseEnd, parseFixedCost, parseGstCredit, parseGstEntry, parseRepaid, parseStage, rupeesToPaise } from './settings'

const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) })
const PRODUCTS = [{ storeId: 'kaiven', sku: 'KV-DHS' }]
const STORES = ['kaiven', 'oorvia', 'selnova']

describe('rupeesToPaise', () => {
  it('reads rupees with commas, ₹ and paise', () => {
    expect(rupeesToPaise('58,050.75')).toBe(5805075)
    expect(rupeesToPaise('₹ 300')).toBe(30000)
    expect(rupeesToPaise('0.1')).toBe(10)
  })
  it('refuses junk, three decimals and negatives unless allowed', () => {
    for (const v of ['', 'abc', '1.234', '1e5', '-5']) expect(rupeesToPaise(v)).toBeNull()
    expect(rupeesToPaise('-5', { allowNegative: true })).toBe(-500)
    expect(rupeesToPaise(null)).toBeNull()
  })
})

describe('isoDate', () => {
  it('needs a real calendar day', () => {
    expect(isoDate('2026-02-28')).toBe('2026-02-28')
    expect(isoDate('2026-02-30')).toBeNull()
    expect(isoDate('21/11/2026')).toBeNull()
  })
})

describe('parseBank', () => {
  it('saves an overdraft but not a future date', () => {
    expect(parseBank(form({ amount: '-1200', date: '2026-11-21' }), '2026-11-21')).toEqual({ ok: true, value: { amount_paise: -120000, entered_on: '2026-11-21', note: null } })
    expect(parseBank(form({ amount: '100', date: '2026-11-22' }), '2026-11-21').ok).toBe(false)
  })
})

describe('parseCogs and parseStage', () => {
  it('only for a product that exists', () => {
    expect(parseCogs(form({ store: 'kaiven', sku: 'KV-DHS', cogs: '312.50', from: '2026-11-21' }), PRODUCTS))
      .toEqual({ ok: true, value: { store_id: 'kaiven', sku: 'KV-DHS', cogs_paise: 31250, effective_from: '2026-11-21' } })
    expect(parseCogs(form({ store: 'oorvia', sku: 'KV-DHS', cogs: '300', from: '2026-11-21' }), PRODUCTS).ok).toBe(false)
    expect(parseStage(form({ store: 'kaiven', sku: 'KV-DHS', stage: 'live' }), PRODUCTS).ok).toBe(true)
    expect(parseStage(form({ store: 'kaiven', sku: 'KV-DHS', stage: 'paused' }), PRODUCTS).ok).toBe(false)
  })
})

describe('parseFixedCost', () => {
  const base = { name: 'Shopify plan', store: 'kaiven', amount: '1994', frequency: 'monthly', start: '2027-03-07' }
  it('a monthly store cost, GST ticked', () => {
    expect(parseFixedCost(form({ ...base, gst: 'on', end: '2027-12-06' }), STORES)).toEqual({
      ok: true,
      value: { store_id: 'kaiven', name: 'Shopify plan', amount_paise: 199400, frequency: 'monthly', start_date: '2027-03-07', end_date: '2027-12-06', gst_inclusive: true, rcm: false, note: null },
    })
  })
  it('a shared cost has no store; a one-time cost drops any end date', () => {
    const r = parseFixedCost(form({ ...base, store: '', frequency: 'one-time', end: '2027-04-01' }), STORES)
    expect(r.ok && r.value.store_id).toBeNull()
    expect(r.ok && r.value.end_date).toBeNull()
  })
  it('refuses an unknown store, zero, an end before the start', () => {
    expect(parseFixedCost(form({ ...base, store: 'avesto' }), STORES).ok).toBe(false)
    expect(parseFixedCost(form({ ...base, amount: '0' }), STORES).ok).toBe(false)
    expect(parseFixedCost(form({ ...base, end: '2027-03-06' }), STORES)).toEqual({ ok: false, error: 'End date is before the start date' })
  })
  it('flags a foreign bill as RCM, never with GST inside it', () => {
    const r = parseFixedCost(form({ ...base, store: '', rcm: 'on' }), STORES)
    expect(r.ok && r.value.rcm).toBe(true)
    expect(parseFixedCost(form({ ...base, rcm: 'on', gst: 'on' }), STORES).ok).toBe(false)
  })
})

describe('parseEnd', () => {
  it('needs a positive id and a date', () => {
    expect(parseEnd(form({ id: '7', end: '2026-12-31' }))).toEqual({ ok: true, value: { id: 7, end_date: '2026-12-31' } })
    expect(parseEnd(form({ id: '0', end: '2026-12-31' })).ok).toBe(false)
    expect(parseEnd(form({ id: '7', end: '' })).ok).toBe(false)
  })
})

describe('GST inputs', () => {
  it('isoMonth needs a real month', () => {
    expect(isoMonth('2026-11')).toBe('2026-11')
    expect(isoMonth('2026-13')).toBeNull()
    expect(isoMonth('2026-11-01')).toBeNull()
  })
  it('an entry works its GST out from taxable × rate', () => {
    expect(parseGstEntry(form({ month: '2026-11', kind: 'itc', source: 'Amazon', taxable: '1000.50', rate: '18' }))).toEqual({
      ok: true, value: { month: '2026-11-01', kind: 'itc', source: 'Amazon', description: null, taxable_paise: 100050, rate: 18, gst_paise: 18009, note: null },
    })
    expect(parseGstEntry(form({ month: '2026-11', kind: 'refund', source: 'x', taxable: '1', rate: '18' })).ok).toBe(false)
    expect(parseGstEntry(form({ month: '2026-11', kind: 'itc', source: '', taxable: '1', rate: '18' })).ok).toBe(false)
    expect(parseGstEntry(form({ month: '2026-11', kind: 'itc', source: 'x', taxable: '1', rate: '118' })).ok).toBe(false)
  })
  it('a credit ledger balance is for a month already over', () => {
    expect(parseGstCredit(form({ month: '2026-10', balance: '17,369.99' }), '2026-11')).toEqual({ ok: true, value: { month: '2026-10-01', balance_paise: 1736999, note: null } })
    expect(parseGstCredit(form({ month: '2026-11', balance: '1' }), '2026-11').ok).toBe(false)
  })
})

describe('capital inputs', () => {
  const loan = { kind: 'loan', name: 'Laxman Khemani', amount: '265000', received: '2026-04-21', due: '2026-05-31' }
  it('a loan keeps interest as a fraction (blank is none) and a due date; partner capital has neither', () => {
    expect(parseCapital(form({ ...loan, rate: '' }))).toEqual({
      ok: true, value: { kind: 'loan', name: 'Laxman Khemani', amount_paise: 26500000, received_on: '2026-04-21', interest_rate: 0, due_on: '2026-05-31', repaid_paise: 0, note: null },
    })
    const r = parseCapital(form({ ...loan, rate: '12' }))
    expect(r.ok && r.value.interest_rate).toBe(0.12)
    const p = parseCapital(form({ ...loan, kind: 'partner', rate: '12' }))
    expect(p.ok && [p.value.interest_rate, p.value.due_on]).toEqual([null, null])
  })
  it('refuses a due date before the money came in, and junk repaid amounts', () => {
    expect(parseCapital(form({ ...loan, due: '2026-04-01' })).ok).toBe(false)
    expect(parseRepaid(form({ id: '1', repaid: '50,000' }))).toEqual({ ok: true, value: { id: 1, repaid_paise: 5000000 } })
    expect(parseRepaid(form({ id: '1', repaid: '-5' })).ok).toBe(false)
  })
})
