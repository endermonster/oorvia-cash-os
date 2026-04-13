// Pure P&L calculation functions — no DB calls, no side effects.

function round2(n) {
  return Math.round(n * 100) / 100
}

/**
 * Auto-compute platform fees from order primitives.
 * Returns rupee amounts (not percentages).
 */
export function computeOrderFees(sellingPrice, paymentMode) {
  const checkout = round2(sellingPrice * 0.0236) // 2% + 18% GST on 2%
  const paymentGw = paymentMode === 'prepaid' ? round2(sellingPrice * 0.025) : 0
  return { checkout, paymentGw }
}

/**
 * Compute net profit for a single order.
 * All fee fields must be positive rupee amounts.
 * cogsTotal = sum of (unit_cogs × quantity) from order_items.
 */
export function computeOrderNetProfit(order, cogsTotal = 0) {
  const revenue = order.status === 'rto' ? 0 : Number(order.selling_price || 0)
  const deductions =
    Number(order.checkout_fee || 0) +
    Number(order.payment_gateway_fee || 0) +
    Number(order.inbound_fee || 0) +
    Number(order.delivery_charge || 0) +
    Number(order.packing_fee || 0) +
    Number(order.cod_handling_fee || 0) +
    Number(order.other_3pl_charges || 0) +
    Number(order.rto_charge || 0) +
    Number(order.meta_ad_spend_attributed || 0) +
    Number(cogsTotal)
  return round2(revenue - deductions)
}

/**
 * Aggregate a set of orders + ad spend + order items into a monthly_pnl shape.
 * orders: rows from `orders` table for the month
 * adSpend: rows from `ad_spend` table for the month
 * itemsMap: Map<order_id, { totalCogs: number }> — pre-aggregated COGS per order
 */
export function computeMonthlyPnL(orders, adSpend, itemsMap = new Map()) {
  let grossRevenue = 0
  let rtoRevenueLost = 0
  let totalCheckoutFees = 0
  let totalPaymentGwFees = 0
  let total3plCharges = 0
  let totalRtoCharges = 0
  let totalCogs = 0
  let orderCount = 0
  let rtoCount = 0
  let codCount = 0
  let prepaidCount = 0

  for (const o of orders) {
    orderCount++
    const price = Number(o.selling_price || 0)
    grossRevenue += price

    if (o.status === 'rto') {
      rtoRevenueLost += price
      rtoCount++
    }

    if (o.payment_mode === 'cod') codCount++
    else prepaidCount++

    totalCheckoutFees += Number(o.checkout_fee || 0)
    totalPaymentGwFees += Number(o.payment_gateway_fee || 0)
    total3plCharges +=
      Number(o.inbound_fee || 0) +
      Number(o.delivery_charge || 0) +
      Number(o.packing_fee || 0) +
      Number(o.cod_handling_fee || 0) +
      Number(o.other_3pl_charges || 0)
    totalRtoCharges += Number(o.rto_charge || 0)

    const cogs = itemsMap.get(o.id)?.totalCogs || 0
    totalCogs += cogs
  }

  const totalAdSpend = adSpend.reduce((s, r) => s + Number(r.spend || 0), 0)
  const actualRevenue = grossRevenue - rtoRevenueLost
  const netProfit =
    actualRevenue -
    totalCheckoutFees -
    totalPaymentGwFees -
    total3plCharges -
    totalRtoCharges -
    totalAdSpend -
    totalCogs

  return {
    gross_revenue: round2(grossRevenue),
    rto_revenue_lost: round2(rtoRevenueLost),
    actual_revenue: round2(actualRevenue),
    total_checkout_fees: round2(totalCheckoutFees),
    total_payment_gw_fees: round2(totalPaymentGwFees),
    total_3pl_charges: round2(total3plCharges),
    total_rto_charges: round2(totalRtoCharges),
    total_ad_spend: round2(totalAdSpend),
    total_cogs: round2(totalCogs),
    net_profit: round2(netProfit),
    order_count: orderCount,
    rto_count: rtoCount,
    cod_order_count: codCount,
    prepaid_order_count: prepaidCount,
  }
}

/**
 * Given wallet entries sorted ascending by date,
 * returns entries with an added `running_balance` field.
 */
export function computeRunningBalance(entries) {
  let balance = 0
  return entries.map((e) => {
    const amt = Number(e.amount || 0)
    if (e.entry_type === 'credit') balance += amt
    else balance -= amt // debit and withdrawal both reduce balance
    return { ...e, running_balance: round2(balance) }
  })
}

/**
 * Format a number as Indian Rupee currency string.
 */
export function fmtINR(n) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

/**
 * Returns YYYY-MM string for a given Date.
 */
export function toMonthStr(date) {
  return date.toISOString().slice(0, 7)
}

/**
 * Returns the first day of a month as a Date, given YYYY-MM string.
 */
export function monthStart(monthStr) {
  return new Date(monthStr + '-01')
}

/**
 * Returns the last day of a month as a Date, given YYYY-MM string.
 */
export function monthEnd(monthStr) {
  const d = new Date(monthStr + '-01')
  d.setMonth(d.getMonth() + 1)
  d.setDate(d.getDate() - 1)
  return d
}
