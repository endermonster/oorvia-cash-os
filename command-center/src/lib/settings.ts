/**
 * Form input for /settings, checked before anything is written. Pure: FormData-like values in, a typed row or an
 * error message out. Money is typed in rupees and stored in integer paise.
 */
import type { ProductStage } from './types'

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }
const fail = <T>(error: string): Parsed<T> => ({ ok: false, error })

/** Anything a FormData `get` returns; files are never valid here. */
type Field = FormDataEntryValue | null | undefined
const text = (v: Field) => (typeof v === 'string' ? v.trim() : '')

/** "58,050.75", "₹58050" → 5805075 paise. Negative only when `allowNegative` (a bank overdraft). */
export function rupeesToPaise(v: Field, { allowNegative = false } = {}): number | null {
  const t = text(v).replace(/[,₹\s]/g, '')
  if (!(allowNegative ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/).test(t)) return null
  const paise = Math.round(Number(t) * 100)
  return Number.isSafeInteger(paise) ? paise : null
}

/** A real calendar date, YYYY-MM-DD. */
export function isoDate(v: Field): string | null {
  const t = text(v)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
  const d = new Date(`${t}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t ? t : null
}

export const STAGES: ProductStage[] = ['testing', 'live', 'out_of_stock', 'failed']
export const STAGE_LABEL: Record<ProductStage, string> = { testing: 'Testing', live: 'Live', out_of_stock: 'Out of stock', failed: 'Failed' }

/** The store must be one we know; '' means none (a VXP-wide cost). */
function storeOf(v: Field, storeIds: string[], allowNone: boolean): Parsed<string | null> {
  const s = text(v)
  if (s === '' && allowNone) return { ok: true, value: null }
  return storeIds.includes(s) ? { ok: true, value: s } : fail('Pick a store')
}

export type BankInput = { amount_paise: number; entered_on: string; note: string | null }
export function parseBank(f: { get(k: string): Field }, today: string): Parsed<BankInput> {
  const amount = rupeesToPaise(f.get('amount'), { allowNegative: true })
  if (amount === null) return fail('Balance must be rupees, e.g. 58050 or 58050.75')
  const date = isoDate(f.get('date'))
  if (!date) return fail('Date must be a real date')
  if (date > today) return fail('Date can’t be in the future')
  return { ok: true, value: { amount_paise: amount, entered_on: date, note: text(f.get('note')).slice(0, 200) || null } }
}

export type CogsInput = { store_id: string; sku: string; cogs_paise: number; effective_from: string }
/** `products`: the (store, SKU) pairs that exist; a cost for anything else would fail the foreign key anyway. */
export function parseCogs(f: { get(k: string): Field }, products: { storeId: string; sku: string }[]): Parsed<CogsInput> {
  const store = text(f.get('store')), sku = text(f.get('sku'))
  if (!products.some((p) => p.storeId === store && p.sku === sku)) return fail('Unknown product')
  const cogs = rupeesToPaise(f.get('cogs'))
  if (cogs === null) return fail('Cost must be rupees, ex-GST, e.g. 300 or 312.50')
  const from = isoDate(f.get('from'))
  if (!from) return fail('“Effective from” must be a real date')
  return { ok: true, value: { store_id: store, sku, cogs_paise: cogs, effective_from: from } }
}

export type StageInput = { store_id: string; sku: string; stage: ProductStage }
export function parseStage(f: { get(k: string): Field }, products: { storeId: string; sku: string }[]): Parsed<StageInput> {
  const store = text(f.get('store')), sku = text(f.get('sku')), stage = text(f.get('stage')) as ProductStage
  if (!products.some((p) => p.storeId === store && p.sku === sku)) return fail('Unknown product')
  if (!STAGES.includes(stage)) return fail('Unknown stage')
  return { ok: true, value: { store_id: store, sku, stage } }
}

export type FixedCostInput = {
  store_id: string | null; name: string; amount_paise: number; frequency: 'monthly' | 'one-time'
  start_date: string; end_date: string | null; gst_inclusive: boolean
  /** Billed from abroad (Shopify, Claude, ChatGPT): 18% RCM on it, paid in cash. */
  rcm: boolean; note: string | null
}
export function parseFixedCost(f: { get(k: string): Field }, storeIds: string[]): Parsed<FixedCostInput> {
  const store = storeOf(f.get('store'), storeIds, true)
  if (!store.ok) return store
  const name = text(f.get('name')).slice(0, 80)
  if (!name) return fail('Give the cost a name')
  const amount = rupeesToPaise(f.get('amount'))
  if (amount === null || amount === 0) return fail('Amount must be rupees above zero')
  const frequency = text(f.get('frequency'))
  if (frequency !== 'monthly' && frequency !== 'one-time') return fail('Pick monthly or one-time')
  const start = isoDate(f.get('start'))
  if (!start) return fail('Start date must be a real date')
  const endRaw = text(f.get('end'))
  const end = endRaw === '' ? null : isoDate(endRaw)
  if (endRaw !== '' && !end) return fail('End date must be a real date, or blank')
  if (end && end < start) return fail('End date is before the start date')
  if (f.get('rcm') === 'on' && f.get('gst') === 'on') return fail('A foreign (RCM) bill has no GST in it: untick “Amount includes GST”')
  return {
    ok: true,
    value: {
      store_id: store.value, name, amount_paise: amount, frequency, start_date: start,
      // A one-time cost has no end: it lands once, on its start date.
      end_date: frequency === 'one-time' ? null : end,
      gst_inclusive: f.get('gst') === 'on', rcm: f.get('rcm') === 'on', note: text(f.get('note')).slice(0, 200) || null,
    },
  }
}

/** Ending a monthly cost: the last day it still bills. */
export function parseEnd(f: { get(k: string): Field }): Parsed<{ id: number; end_date: string }> {
  const id = Number(text(f.get('id')))
  if (!Number.isSafeInteger(id) || id <= 0) return fail('Unknown cost')
  const end = isoDate(f.get('end'))
  if (!end) return fail('End date must be a real date')
  return { ok: true, value: { id, end_date: end } }
}

/** <input type="month">: YYYY-MM, a real month. */
export function isoMonth(v: Field): string | null {
  const t = text(v)
  if (!/^\d{4}-\d{2}$/.test(t)) return null
  const m = Number(t.slice(5))
  return m >= 1 && m <= 12 ? t : null
}

/** A percentage typed as "18" or "18.5", 0 to 100. */
function percent(v: Field): number | null {
  const t = text(v)
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null
  const p = Number(t)
  return p <= 100 ? p : null
}

export const GST_KINDS = ['itc', 'otc', 'rcm'] as const
export const GST_KIND_LABEL: Record<(typeof GST_KINDS)[number], string> = { itc: 'Input credit', otc: 'Output tax', rcm: 'RCM (foreign supplier)' }

export type GstEntryInput = { month: string; kind: (typeof GST_KINDS)[number]; source: string; description: string | null; taxable_paise: number; rate: number; gst_paise: number; note: string | null }
/** GST is always worked out here from taxable × rate, never typed. */
export function parseGstEntry(f: { get(k: string): Field }): Parsed<GstEntryInput> {
  const month = isoMonth(f.get('month'))
  if (!month) return fail('Pick the return month')
  const kind = text(f.get('kind')) as GstEntryInput['kind']
  if (!GST_KINDS.includes(kind)) return fail('Pick input credit, output tax or RCM')
  const source = text(f.get('source')).slice(0, 80)
  if (!source) return fail('Say who billed it (the supplier)')
  const taxable = rupeesToPaise(f.get('taxable'))
  if (taxable === null || taxable === 0) return fail('Taxable value must be rupees above zero, ex-GST')
  const rate = percent(f.get('rate'))
  if (rate === null) return fail('GST rate must be a percentage, e.g. 18')
  return {
    ok: true,
    value: {
      month: `${month}-01`, kind, source, description: text(f.get('description')).slice(0, 200) || null,
      taxable_paise: taxable, rate, gst_paise: Math.round((taxable * rate) / 100), note: text(f.get('note')).slice(0, 200) || null,
    },
  }
}

export type GstCreditInput = { month: string; balance_paise: number; note: string | null }
/** The credit ledger total left after filing a month: only a month already over can have been filed. */
export function parseGstCredit(f: { get(k: string): Field }, currentMonth: string): Parsed<GstCreditInput> {
  const month = isoMonth(f.get('month'))
  if (!month) return fail('Pick the month whose return you filed')
  if (month >= currentMonth) return fail('Only a past month can have been filed')
  const balance = rupeesToPaise(f.get('balance'))
  if (balance === null) return fail('Balance must be rupees, e.g. 17369.99')
  return { ok: true, value: { month: `${month}-01`, balance_paise: balance, note: text(f.get('note')).slice(0, 200) || null } }
}

export type CapitalInput = {
  kind: 'loan' | 'partner'; name: string; amount_paise: number; received_on: string
  interest_rate: number | null; due_on: string | null; repaid_paise: number; note: string | null
}
export function parseCapital(f: { get(k: string): Field }): Parsed<CapitalInput> {
  const kind = text(f.get('kind'))
  if (kind !== 'loan' && kind !== 'partner') return fail('Pick loan or partner capital')
  const name = text(f.get('name')).slice(0, 80)
  if (!name) return fail(kind === 'loan' ? 'Say who lent it' : 'Say which partner put it in')
  const amount = rupeesToPaise(f.get('amount'))
  if (amount === null || amount === 0) return fail('Amount must be rupees above zero')
  const received = isoDate(f.get('received'))
  if (!received) return fail('Date received must be a real date')
  let rate: number | null = null, due: string | null = null
  if (kind === 'loan') {
    const r = text(f.get('rate')) === '' ? 0 : percent(f.get('rate'))
    if (r === null) return fail('Interest must be a yearly percentage, e.g. 12, or blank for none')
    rate = r / 100
    const dueRaw = text(f.get('due'))
    due = dueRaw === '' ? null : isoDate(dueRaw)
    if (dueRaw !== '' && !due) return fail('Due date must be a real date, or blank')
    if (due && due < received) return fail('Due date is before the date received')
  }
  return { ok: true, value: { kind, name, amount_paise: amount, received_on: received, interest_rate: rate, due_on: due, repaid_paise: 0, note: text(f.get('note')).slice(0, 200) || null } }
}

/** Total repaid so far (not a single payment), up to the amount. */
export function parseRepaid(f: { get(k: string): Field }): Parsed<{ id: number; repaid_paise: number }> {
  const id = Number(text(f.get('id')))
  if (!Number.isSafeInteger(id) || id <= 0) return fail('Unknown entry')
  const repaid = rupeesToPaise(f.get('repaid'))
  if (repaid === null) return fail('Repaid must be rupees, e.g. 50000')
  return { ok: true, value: { id, repaid_paise: repaid } }
}
