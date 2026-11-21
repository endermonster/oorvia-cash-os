/**
 * Monthly P&L from real data, per store and for VXP. Pure: the loader (./pnl-load.ts) fetches, this computes.
 * All money is integer paise in and out; every figure is ex-GST (GST on revenue is owed, GST on costs is ITC).
 *
 * The rules carried over from old Cash OS (`app/api/pnl/route.js`), which the Phase 0 answer keys were made with:
 * - An order's month is its **delivery** month when it was delivered (GST time of supply), else its order month.
 * - Only delivered orders earn revenue and carry COGS. An RTO or cancelled order earns ₹0 and its stock comes back,
 *   but every fee it ran up still counts.
 * - vFulfill charges are the real ledger rows, booked in the month of the order they belong to.
 * - Checkout (Fastrr): 2% of order value on every order, cancelled included. Gateway: prepaid orders only.
 *
 * New here:
 * - Costs that belong to no one store (vFulfill storage, subscription, inward fees; fixed costs with no store) sit in
 *   the VXP total only, never split across stores (decided 2026-11-20).
 * - vFulfill's quarterly Subscription Charge is a quarterly fixed cost, booked whole in the months it bills (decided
 *   2026-11-22); its wallet debit is left out of the vFulfill fees so it isn't counted twice.
 * - Lost Claims credits reduce vFulfill fees.
 */

export const GST = 0.18
export const CHECKOUT_PCT = 0.02
/** Cashfree's rate on Oorvia (old Cash OS CASHFREE_FEE_RATE). Other gateways use the store's `gateway_pct`. */
export const CASHFREE_PCT = 0.025

/** `liveSince`: orders placed before it are left out (Oorvia's pre-tracking history is a separate baseline). */
export type PnlStore = { id: string; gatewayPct: number; ownerShare: number; liveSince?: string }

export type PnlOrder = {
  storeId: string
  orderName: string
  /** Date placed, IST, YYYY-MM-DD. */
  orderDate: string
  payment: 'cod' | 'prepaid' | 'unknown'
  gateways: string[]
  /** What the customer paid, GST included. */
  totalPaise: number
  cancelled: boolean
  /** From the vFulfill shipments export; null when it has no shipment yet. */
  shipStatus: 'delivered' | 'rto' | 'open' | null
  closedOn: string | null
  /** COGS of every line at the order date, ex-GST; `cogsKnown` false when any line has no cost on record. */
  cogsPaise: number
  cogsKnown: boolean
}

export type PnlTxn = {
  storeId: string | null
  orderName: string | null
  txnDate: string
  head: string
  nature: 'debit' | 'credit'
  taxablePaise: number | null
  totalPaise: number
}

export type PnlSpend = { storeId: string; date: string; spendPaise: number }

export type FixedCost = {
  /** Null: shared by VXP, shown in the VXP total only. */
  storeId: string | null
  name: string
  amountPaise: number
  frequency: 'monthly' | 'quarterly' | 'one-time'
  startDate: string
  /** Inclusive; null runs on. */
  endDate: string | null
  gstInclusive: boolean
}

export type PnlLine = {
  orders: { delivered: number; rto: number; open: number; cancelled: number }
  revenueGross: number
  revenueNet: number
  cogs: number
  /** Delivered orders with a line that has no cost on record: COGS is understated by them. */
  cogsMissing: number
  vfFees: number
  vfByHead: Record<string, number>
  checkoutFees: number
  gatewayFees: number
  adSpend: number
  fixedCosts: number
  netProfit: number
  /** Net profit × the owner's share. Null on VXP when stores' shares differ. */
  ownerShare: number | null
}

export type MonthPnl = {
  month: string
  stores: Record<string, PnlLine>
  /** Costs in the VXP total that no store carries. */
  shared: { vfByHead: Record<string, number>; fixed: Record<string, number> }
  vxp: PnlLine
}

export type PnlResult = {
  months: MonthPnl[]
  warnings: string[]
}

/** Wallet heads that are a cost of the business as a whole. */
const SHARED_VF_HEADS = new Set(['Storage Charges', 'Inward Fees', 'Wallet Recharge Service Fee', 'Subscription Charge'])
/** Money moving, not a cost: top-ups, withdrawals, stock bought (that reaches the P&L as COGS), COD cash coming in. */
const NOT_A_COST = new Set(['Add Funds - Wire', 'Add Funds - Razorpay', 'Withdraw Funds', 'Client Sourcing Request', 'COD Remittance'])
/** Modelled as a quarterly fixed cost (cc_fixed_costs): the ledger debit stays in the wallet, out of the P&L. */
const AS_FIXED_COST = new Set(['Subscription Charge'])

export const monthOf = (date: string) => date.slice(0, 7)
const daysIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
/** Whole months from `from` to `to` (YYYY-MM); negative when `to` is earlier. */
export const monthsBetween = (from: string, to: string) =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7))

export function addMonths(month: string, n: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export type OrderLine = { store_id: string; order_name: string; sku: string | null; qty: number; shopify_product_id: string | null }
export type CogsEntry = { store_id: string; sku: string; cogs_paise: number; effective_from: string }

/**
 * COGS per order (`store|order` key), the cc_order_facts way but for every order, cancelled included: each product
 * line (a SKU or a Shopify product id) × the latest cost starting on or before the order date. `cogsKnown` is false
 * when any product line has no cost on record.
 */
export function orderCogs(
  orders: { storeId: string; orderName: string; date: string }[], lines: OrderLine[], history: CogsEntry[],
): Map<string, { cogsPaise: number; cogsKnown: boolean }> {
  const hist = new Map<string, CogsEntry[]>()
  for (const h of history) {
    const k = `${h.store_id}|${h.sku}`
    const list = hist.get(k)
    if (list) list.push(h)
    else hist.set(k, [h])
  }
  const costAt = (store: string, sku: string | null, date: string): number | null => {
    if (!sku) return null
    let best: CogsEntry | null = null
    for (const h of hist.get(`${store}|${sku}`) ?? []) if (h.effective_from <= date && (!best || h.effective_from > best.effective_from)) best = h
    return best ? best.cogs_paise : null
  }
  const dateOf = new Map(orders.map((o) => [`${o.storeId}|${o.orderName}`, o.date]))
  const out = new Map<string, { cogsPaise: number; cogsKnown: boolean }>()
  for (const l of lines) {
    if (l.sku === null && l.shopify_product_id === null) continue // not a product (shipping, tips)
    const k = `${l.store_id}|${l.order_name}`
    const date = dateOf.get(k)
    if (!date) continue
    const cur = out.get(k) ?? { cogsPaise: 0, cogsKnown: true }
    const unit = costAt(l.store_id, l.sku, date)
    if (unit === null) cur.cogsKnown = false
    else cur.cogsPaise += unit * l.qty
    out.set(k, cur)
  }
  return out
}

/** Ex-GST amount of a vFulfill row: its taxable amount, else the total with GST taken out. */
const exGst = (t: Pick<PnlTxn, 'taxablePaise' | 'totalPaise'>) => t.taxablePaise ?? t.totalPaise / (1 + GST)

export function gatewayRate(gateways: string[], storeGatewayPct: number): number {
  return gateways.some((g) => /cashfree/i.test(g)) ? CASHFREE_PCT : storeGatewayPct
}

/**
 * The date in `month` that falls on `day` of the month, or the month's last day when it is shorter
 * (a cost billed on the 30th lands on 28 Feb).
 */
export const billingDate = (month: string, day: number) => `${month}-${String(Math.min(day, daysIn(month))).padStart(2, '0')}`

/**
 * What a fixed cost charges in one calendar month, ex-GST, booked whole on its billing date (decided 2026-11-20):
 * a monthly cost bills on its start date's day of the month, each month from `startDate` to `endDate`; a quarterly
 * one the same, every third month from its start month; a one-time cost on its start date. Nothing is charged after
 * `asOf` (today), so a month in progress shows only bills already due.
 */
export function fixedInMonth(fc: FixedCost, month: string, asOf?: string): number {
  const amount = fc.gstInclusive ? fc.amountPaise / (1 + GST) : fc.amountPaise
  if (fc.frequency === 'quarterly' && monthsBetween(monthOf(fc.startDate), month) % 3 !== 0) return 0
  const on = fc.frequency === 'one-time' ? fc.startDate : billingDate(month, Number(fc.startDate.slice(8, 10)))
  if (monthOf(on) !== month || on < fc.startDate) return 0
  if (fc.endDate && on > fc.endDate) return 0
  if (asOf && on > asOf) return 0
  return amount
}

/**
 * VXP's recurring fixed costs per month, ex-GST, every store and shared: the monthly costs running on `today`, and a
 * third of each quarterly one. One-time costs are left out: a run rate, for breakeven, not a bill. Null when no fixed
 * cost is on record at all.
 */
export function monthlyRunRate(fcs: FixedCost[], today: string): number | null {
  if (fcs.length === 0) return null
  return fcs
    .filter((fc) => fc.frequency !== 'one-time' && fc.startDate <= today && (fc.endDate === null || fc.endDate >= today))
    .reduce((s, fc) => s + (fc.gstInclusive ? fc.amountPaise / (1 + GST) : fc.amountPaise) / (fc.frequency === 'quarterly' ? 3 : 1), 0)
}

type Acc = Omit<PnlLine, 'netProfit' | 'ownerShare'>
const emptyAcc = (): Acc => ({
  orders: { delivered: 0, rto: 0, open: 0, cancelled: 0 },
  revenueGross: 0, revenueNet: 0, cogs: 0, cogsMissing: 0, vfFees: 0, vfByHead: {}, checkoutFees: 0, gatewayFees: 0, adSpend: 0, fixedCosts: 0,
})

function finish(a: Acc, share: number | null): PnlLine {
  const r = Math.round
  const vfByHead = Object.fromEntries(Object.entries(a.vfByHead).map(([k, v]) => [k, r(v)]))
  const line = {
    orders: a.orders, cogsMissing: a.cogsMissing,
    revenueGross: r(a.revenueGross), revenueNet: r(a.revenueNet), cogs: r(a.cogs),
    vfFees: Object.values(vfByHead).reduce((s, v) => s + v, 0), vfByHead,
    checkoutFees: r(a.checkoutFees), gatewayFees: r(a.gatewayFees), adSpend: r(a.adSpend), fixedCosts: r(a.fixedCosts),
  }
  // From the rounded lines, so the table adds up on screen.
  const netProfit = line.revenueNet - line.cogs - line.vfFees - line.checkoutFees - line.gatewayFees - line.adSpend - line.fixedCosts
  return { ...line, netProfit, ownerShare: share === null ? null : Math.round(netProfit * share) }
}

/**
 * Months from `fromMonth` to `toMonth` inclusive. Data outside them is ignored. A month still in progress counts
 * only what has happened: orders not delivered yet earn nothing yet.
 */
export function computePnl(input: {
  stores: PnlStore[]
  orders: PnlOrder[]
  txns: PnlTxn[]
  spend: PnlSpend[]
  fixed: FixedCost[]
  fromMonth: string
  toMonth: string
  /** Today (YYYY-MM-DD). Fixed costs and subscription thirds billed after it are not counted yet. */
  asOf?: string
}): PnlResult {
  const { stores, orders, txns, spend, fixed, fromMonth, toMonth, asOf } = input
  const warnings: string[] = []
  const months: string[] = []
  for (let m = fromMonth; m <= toMonth; m = addMonths(m, 1)) months.push(m)
  const inRange = (m: string) => m >= fromMonth && m <= toMonth

  const storeById = new Map(stores.map((s) => [s.id, s]))
  const acc = new Map<string, Acc>() // `${month}|${storeId}`
  const sharedVf = new Map<string, Record<string, number>>()
  const at = (month: string, storeId: string) => {
    const k = `${month}|${storeId}`
    let a = acc.get(k)
    if (!a) { a = emptyAcc(); acc.set(k, a) }
    return a
  }
  const addVf = (rec: Record<string, number>, head: string, paise: number) => { rec[head] = (rec[head] ?? 0) + paise }
  const unknownStores = new Set<string>()
  const known = (storeId: string) => {
    if (storeById.has(storeId)) return true
    unknownStores.add(storeId)
    return false
  }

  // COD cash arrives only after delivery: a remittance for an order whose shipment the export still shows open is a
  // delivery, dated the remittance day (decided 2026-11-20; three such Oorvia orders in May–June 2026).
  const remittedOn = new Map<string, string>()
  for (const t of txns) {
    if (t.head !== 'COD Remittance' || t.nature !== 'credit' || !t.storeId || !t.orderName) continue
    const k = `${t.storeId}|${t.orderName}`
    const prev = remittedOn.get(k)
    if (!prev || t.txnDate < prev) remittedOn.set(k, t.txnDate)
  }
  const deliveredByCash: string[] = []
  // An order billed a real checkout fee in the ledger is not charged the computed 2% too (Codex review).
  const CHECKOUT_HEAD = 'Checkout Service Fee'
  const billedCheckout = new Set(txns.filter((t) => t.head === CHECKOUT_HEAD && t.storeId && t.orderName).map((t) => `${t.storeId}|${t.orderName}`))
  /** Orders left out on purpose (placed before the store went live): their ledger charges are left out with them. */
  const excluded = new Set<string>()

  // Orders: revenue, COGS, checkout and gateway fees, in the order's month.
  const orderMonth = new Map<string, string>()
  let missingCogs = 0
  for (const o of orders) {
    if (!known(o.storeId)) continue
    const since = storeById.get(o.storeId)!.liveSince
    if (since && o.orderDate < since) { excluded.add(`${o.storeId}|${o.orderName}`); continue }
    // The shipment decides (CLAUDE.md, source of truth): Shopify marks an RTO'd order cancelled, so "cancelled"
    // only means cancelled when vFulfill never closed a shipment for it.
    const remitted = o.shipStatus !== 'delivered' && o.shipStatus !== 'rto' ? remittedOn.get(`${o.storeId}|${o.orderName}`) : undefined
    if (remitted) deliveredByCash.push(o.orderName)
    const deliveredOn = remitted ?? (o.shipStatus === 'delivered' ? o.closedOn : null)
    const delivered = deliveredOn !== null
    const month = monthOf(deliveredOn ?? o.orderDate)
    orderMonth.set(`${o.storeId}|${o.orderName}`, month)
    if (!inRange(month)) continue
    const a = at(month, o.storeId)
    if (delivered) a.orders.delivered++
    else if (o.shipStatus === 'rto') a.orders.rto++
    else if (o.cancelled) a.orders.cancelled++
    else a.orders.open++
    if (delivered) {
      a.revenueGross += o.totalPaise
      a.revenueNet += o.totalPaise / (1 + GST)
      a.cogs += o.cogsPaise
      if (!o.cogsKnown) { a.cogsMissing++; missingCogs++ }
    }
    if (!billedCheckout.has(`${o.storeId}|${o.orderName}`)) a.checkoutFees += o.totalPaise * CHECKOUT_PCT
    if (o.payment === 'prepaid') a.gatewayFees += o.totalPaise * gatewayRate(o.gateways, storeById.get(o.storeId)!.gatewayPct)
  }
  if (deliveredByCash.length > 0) {
    warnings.push(`${deliveredByCash.length} order${deliveredByCash.length === 1 ? '' : 's'} counted delivered because vFulfill remitted the COD cash, though its export still shows the shipment open: ${deliveredByCash.join(', ')}`)
  }
  if (missingCogs > 0) warnings.push(`${missingCogs} delivered order${missingCogs === 1 ? '' : 's'} with a product that has no cost on record: COGS is understated`)

  // vFulfill ledger.
  const unknownHeads = new Map<string, number>()
  let unmatched = 0
  for (const t of txns) {
    if (NOT_A_COST.has(t.head) || AS_FIXED_COST.has(t.head)) continue
    const sign = t.nature === 'debit' ? 1 : t.head === 'Lost Claims' ? -1 : 0
    if (sign === 0) continue // a credit that is not a refund of a cost
    const paise = sign * exGst(t)
    if (t.storeId && t.orderName && known(t.storeId)) {
      const k = `${t.storeId}|${t.orderName}`
      if (excluded.has(k)) continue
      const month = orderMonth.get(k)
      if (!month) unmatched++
      const m = month ?? monthOf(t.txnDate) // a charge for an order not in Shopify still counts, in its own month
      if (!inRange(m)) continue
      const a = at(m, t.storeId)
      if (t.head === CHECKOUT_HEAD) a.checkoutFees += paise // the real charge, on the checkout line
      else addVf(a.vfByHead, t.head, paise)
      continue
    }
    if (!SHARED_VF_HEADS.has(t.head)) unknownHeads.set(t.head, (unknownHeads.get(t.head) ?? 0) + 1)
    // Shared: the VXP total only, in the month charged.
    const m = monthOf(t.txnDate)
    if (!inRange(m)) continue
    let rec = sharedVf.get(m)
    if (!rec) { rec = {}; sharedVf.set(m, rec) }
    addVf(rec, t.head, paise)
  }
  if (unmatched > 0) warnings.push(`${unmatched} vFulfill charge${unmatched === 1 ? '' : 's'} for orders not in Shopify data, booked in the month charged`)
  for (const [head, n] of unknownHeads) warnings.push(`vFulfill head "${head}" (${n}×) is new: counted as a shared cost until it is classified`)

  for (const s of spend) {
    if (!known(s.storeId)) continue
    const m = monthOf(s.date)
    if (inRange(m)) at(m, s.storeId).adSpend += s.spendPaise
  }

  const sharedFixed = new Map<string, Record<string, number>>()
  for (const fc of fixed) {
    if (fc.storeId !== null && !known(fc.storeId)) continue
    for (const m of months) {
      const v = fixedInMonth(fc, m, asOf)
      if (v === 0) continue
      if (fc.storeId !== null) { at(m, fc.storeId).fixedCosts += v; continue }
      let rec = sharedFixed.get(m)
      if (!rec) { rec = {}; sharedFixed.set(m, rec) }
      rec[fc.name] = (rec[fc.name] ?? 0) + v
    }
  }
  for (const id of unknownStores) warnings.push(`Data for unknown store "${id}" left out`)

  const shares = new Set(stores.map((s) => s.ownerShare))
  const vxpShare = shares.size === 1 ? [...shares][0] : null

  const out: MonthPnl[] = months.map((month) => {
    const storeLines: Record<string, PnlLine> = {}
    const total = emptyAcc()
    for (const s of stores) {
      const a = acc.get(`${month}|${s.id}`) ?? emptyAcc()
      storeLines[s.id] = finish(a, s.ownerShare)
      for (const k of ['delivered', 'rto', 'open', 'cancelled'] as const) total.orders[k] += a.orders[k]
      total.revenueGross += a.revenueGross; total.revenueNet += a.revenueNet; total.cogs += a.cogs; total.cogsMissing += a.cogsMissing
      total.checkoutFees += a.checkoutFees; total.gatewayFees += a.gatewayFees; total.adSpend += a.adSpend; total.fixedCosts += a.fixedCosts
      for (const [h, v] of Object.entries(a.vfByHead)) addVf(total.vfByHead, h, v)
    }
    const vf = sharedVf.get(month) ?? {}
    const fx = sharedFixed.get(month) ?? {}
    for (const [h, v] of Object.entries(vf)) addVf(total.vfByHead, h, v)
    total.fixedCosts += Object.values(fx).reduce((s, v) => s + v, 0)
    const r = (rec: Record<string, number>) => Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, Math.round(v)]))
    return { month, stores: storeLines, shared: { vfByHead: r(vf), fixed: r(fx) }, vxp: finish(total, vxpShare) }
  })
  return { months: out, warnings }
}
