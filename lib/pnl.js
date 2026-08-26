// Pure P&L calculation functions — no DB calls, no side effects.

function round2(n) {
  return Math.round(n * 100) / 100
}

// computeOrderFees() removed — its only callers were the deleted /api/orders POST
// and the order form. Checkout and gateway fees are now written as real
// order_costs rows by /api/sync/shopify, using CHECKOUT_FEE_RATE and
// CASHFREE_FEE_RATE from lib/constants.js.

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
