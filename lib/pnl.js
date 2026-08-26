// Pure P&L calculation functions — no DB calls, no side effects.

function round2(n) {
  return Math.round(n * 100) / 100
}

/**
 * Derive Shopify checkout fee and Cashfree payment gateway fee from order primitives.
 * checkout:    2% Shopify charge + 18% GST = 2.36% of order value (GST-inclusive)
 * cashfreeFee: 2.5% of order value for prepaid orders only (base amount, GST on top)
 */
export function computeOrderFees(orderValue, paymentMode) {
  const checkout = round2(orderValue * 0.0236)
  const cashfreeFee = paymentMode === 'prepaid' ? round2(orderValue * 0.025) : 0
  return { checkout, cashfreeFee }
}

/**
 * Compute net profit for a single order.
 * All fee fields must be positive rupee amounts.
 * cogsTotal = sum of (unit_cogs × quantity) from order_items.
 */
export function computeOrderNetProfit(order, cogsTotal = 0) {
  const revenueStatuses = ['active', 'delivered']
  const revenue = revenueStatuses.includes(order.status) ? Number(order.order_value || 0) : 0
  const deductions =
    Number(order.checkout_fee || 0) +
    Number(order.cashfree_fee || 0) +
    Number(order.order_mgmt_fee || 0) +
    Number(order.platform_fee || 0) +
    Number(order.cod_fee || 0) +
    Number(order.forward_shipping_fee || 0) +
    Number(order.fulfillment_fee || 0) +
    Number(order.rto_fee || 0) +
    Number(order.meta_ad_spend_attributed || 0) +
    Number(cogsTotal)
  return round2(revenue - deductions)
}

/**
 * Given wallet entries sorted ascending by date,
 * returns entries with an added `running_balance` field.
 */
export function computeRunningBalance(entries) {
  let balance = 0
  return entries.map((e) => {
    const amt = Number(e.amount || 0)
    if (e.entry_type === 'credit' || e.entry_type === 'add_funds') balance += amt
    else balance -= amt
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

// Date helpers formerly exported here (toMonthStr, monthStart, monthEnd) now live
// in lib/dates.js. They used toISOString(), which shifts a day back in IST.
