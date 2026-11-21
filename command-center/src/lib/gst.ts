/**
 * GST for VXP's one GSTIN (all stores), month by month, as an estimate of what the GSTR-3B will say. Pure: the loader
 * (./gst-load.ts) fetches, this computes. Integer paise out.
 *
 * - **Output tax**: delivered orders, in the month of delivery (time of supply; the shipments export's Closed On), at
 *   18% inside the price. Maharashtra is CGST + SGST, every other state IGST. The P&L's "remitted counts as delivered"
 *   exception is not used here (CLAUDE.md: P&L only).
 * - **Input credit (estimate; GSTR-2B decides)**: GST on vFulfill charges by charge date; 18% of Meta spend (every
 *   ad account bills VXP's GSTIN, Vedaant 2026-11-22); 18% of the checkout and gateway fees the P&L computes;
 *   manual entries; and the RCM tax itself (claimed back in the same return, 4(A)(2)). Invoices often reach the 2B
 *   a month late, so one month can be off while two months together match.
 * - **RCM** (Shopify, Claude, ChatGPT: foreign suppliers): 18% of the fixed costs flagged `rcm` billed that month,
 *   plus manual RCM entries. Must be paid in cash (Sec 49(4)); the credit ledger can't pay it.
 * - **Credit ledger**: starts from the latest balance entered for a filed month and is chained forward month by month.
 *   One total (IGST + CGST + SGST); the per-head offset order is not modelled.
 */
import { CHECKOUT_PCT, fixedInMonth, gatewayRate, GST, monthOf, addMonths, type FixedCost } from './pnl'

export type GstOrder = {
  storeId: string
  orderName: string
  /** Date placed, IST. Fees fall in this month. */
  orderDate: string
  payment: 'cod' | 'prepaid' | 'unknown'
  gateways: string[]
  totalPaise: number
  state: string | null
  /** Closed On of a Delivered shipment; null otherwise. */
  deliveredOn: string | null
}
export type GstTxn = { storeId: string | null; orderName: string | null; txnDate: string; head: string; nature: 'debit' | 'credit'; gstPaise: number | null }
export type GstEntry = { id: number; month: string; kind: 'itc' | 'otc' | 'rcm'; source: string; description: string | null; taxablePaise: number; rate: number; gstPaise: number; note: string | null }
/** Credit ledger balance left after filing `month` (YYYY-MM). */
export type GstSeed = { month: string; balancePaise: number; note: string | null }

export type GstMonth = {
  month: string
  output: { igst: number; cgst: number; sgst: number; manual: number; total: number; orders: number }
  itc: { vfulfill: number; meta: number; checkout: number; gateway: number; rcm: number; manual: number; total: number }
  /** RCM tax, paid in cash. */
  rcm: number
  opening: number
  /** Output tax the credit ledger can't cover, paid in cash. */
  payable: number
  closing: number
  /** Cash to pay with this month's GSTR-3B: payable + RCM (late fee and interest not included). */
  cash: number
  gstr1Due: string
  gstr3bDue: string
  /** True for the month in progress: figures so far. */
  partial: boolean
}

export type GstResult = {
  /** Latest balance entered; the months below start after it. Null: nothing entered, chain starts at 0. */
  seed: GstSeed | null
  /** Every month after the seed up to the current one, oldest first. All but the last are not filed yet. */
  months: GstMonth[]
}

const MAHARASHTRA = new Set(['MH', 'MAHARASHTRA'])
const MAX_MONTHS = 36
/** GSTR-1 on the 11th and GSTR-3B on the 20th of the next month (monthly filer). */
export const dueDates = (month: string) => {
  const next = addMonths(month, 1)
  return { gstr1Due: `${next}-11`, gstr3bDue: `${next}-20` }
}

export function computeGst(input: {
  orders: GstOrder[]
  txns: GstTxn[]
  spend: { date: string; spendPaise: number }[]
  fixed: (FixedCost & { rcm: boolean })[]
  entries: GstEntry[]
  seeds: GstSeed[]
  stores: { id: string; gatewayPct: number }[]
  /** Today, IST. The last month computed is this one. */
  asOf: string
  /** First month when nothing has been entered yet. */
  fromMonth: string
}): GstResult {
  const { orders, txns, spend, fixed, entries, seeds, stores, asOf } = input
  const current = monthOf(asOf)
  const seed = seeds.filter((s) => s.month < current).sort((a, b) => b.month.localeCompare(a.month))[0] ?? null
  const first = seed ? addMonths(seed.month, 1) : input.fromMonth
  const months: string[] = []
  for (let m = first; m <= current && months.length < MAX_MONTHS; m = addMonths(m, 1)) months.push(m)
  const gatewayPct = new Map(stores.map((s) => [s.id, s.gatewayPct]))

  type Acc = { igst: number; cgst: number; sgst: number; otcManual: number; orders: number; vf: number; meta: number; checkout: number; gateway: number; itcManual: number; rcm: number }
  const acc = new Map<string, Acc>(months.map((m) => [m, { igst: 0, cgst: 0, sgst: 0, otcManual: 0, orders: 0, vf: 0, meta: 0, checkout: 0, gateway: 0, itcManual: 0, rcm: 0 }]))
  const at = (m: string) => acc.get(m)

  // An order vFulfill billed a real checkout fee for carries that fee's GST in the ledger already (as the P&L).
  const billedCheckout = new Set(txns.filter((t) => t.head === 'Checkout Service Fee' && t.storeId && t.orderName).map((t) => `${t.storeId}|${t.orderName}`))

  for (const o of orders) {
    if (o.deliveredOn) {
      const a = at(monthOf(o.deliveredOn))
      if (a) {
        // Per invoice, rounded to the paisa, as GSTR-1 reports it.
        const tax = Math.round((o.totalPaise * GST) / (1 + GST))
        if (MAHARASHTRA.has((o.state ?? '').trim().toUpperCase())) {
          const half = Math.round(tax / 2)
          a.cgst += half
          a.sgst += tax - half
        } else a.igst += tax
        a.orders++
      }
    }
    const a = at(monthOf(o.orderDate))
    if (!a) continue
    if (!billedCheckout.has(`${o.storeId}|${o.orderName}`)) a.checkout += o.totalPaise * CHECKOUT_PCT * GST
    if (o.payment === 'prepaid') a.gateway += o.totalPaise * gatewayRate(o.gateways, gatewayPct.get(o.storeId) ?? 0) * GST
  }
  for (const t of txns) {
    const a = at(monthOf(t.txnDate))
    if (a && t.gstPaise) a.vf += t.nature === 'debit' ? t.gstPaise : -t.gstPaise // a credit carrying GST is a credit note
  }
  for (const s of spend) {
    const a = at(monthOf(s.date))
    if (a) a.meta += s.spendPaise * GST
  }
  for (const fc of fixed) {
    if (!fc.rcm) continue
    for (const m of months) at(m)!.rcm += fixedInMonth(fc, m, asOf) * GST
  }
  for (const e of entries) {
    const a = at(e.month)
    if (!a) continue
    if (e.kind === 'otc') a.otcManual += e.gstPaise
    else if (e.kind === 'itc') a.itcManual += e.gstPaise
    else a.rcm += e.gstPaise
  }

  const r = Math.round
  let opening = seed?.balancePaise ?? 0
  const out = months.map((month): GstMonth => {
    const a = acc.get(month)!
    const output = { igst: a.igst, cgst: a.cgst, sgst: a.sgst, manual: a.otcManual, total: a.igst + a.cgst + a.sgst + a.otcManual, orders: a.orders }
    const rcm = r(a.rcm)
    const itcParts = { vfulfill: r(a.vf), meta: r(a.meta), checkout: r(a.checkout), gateway: r(a.gateway), rcm, manual: a.itcManual }
    const itc = { ...itcParts, total: Object.values(itcParts).reduce((s, v) => s + v, 0) }
    const available = opening + itc.total
    const payable = Math.max(0, output.total - available)
    const closing = Math.max(0, available - output.total)
    const line: GstMonth = { month, output, itc, rcm, opening, payable, closing, cash: payable + rcm, ...dueDates(month), partial: month === current }
    opening = closing
    return line
  })
  return { seed, months: out }
}
