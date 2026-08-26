// Pure P&L calculation functions — no DB calls, no side effects.

function round2(n) {
  return Math.round(n * 100) / 100
}

// computeOrderFees() removed — its only callers were the deleted /api/orders POST
// and the order form. Checkout and gateway fees are now written as real
// order_costs rows by /api/sync/shopify, using CHECKOUT_FEE_RATE and
// CASHFREE_FEE_RATE from lib/constants.js.

// computeOrderNetProfit() removed. It summed per-order fee columns that no
// longer exist on `orders`, so every deduction resolved to zero and the Orders
// table printed revenue as profit. /api/orders now returns a real net_profit
// computed from order_costs and cogs_history.

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
