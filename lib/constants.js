// Single source of truth for order status and payment type.
//
// These strings were previously duplicated across the API routes, the filter
// dropdowns, the status badge and the Shopify mapper — and they had drifted.
// The Orders filter offered 'pending' and 'shipped', which match nothing in the
// database, while 'unfulfilled' orders existed but appeared in no filter and no
// report. Add a status here first, then use it; never inline the literal.

// ── Order status ────────────────────────────────────────────────────────────

export const ORDER_STATUS = {
  UNFULFILLED: 'unfulfilled', // paid, not yet shipped
  ACTIVE:      'active',      // shipped, in transit
  DELIVERED:   'delivered',   // delivered — the only status that earns revenue
  RTO:         'rto',         // returned to origin
  CANCELLED:   'cancelled',   // cancelled before or after shipping
}

export const ORDER_STATUS_LIST = Object.values(ORDER_STATUS)

export const ORDER_STATUS_LABELS = {
  [ORDER_STATUS.UNFULFILLED]: 'Unfulfilled',
  [ORDER_STATUS.ACTIVE]:      'In transit',
  [ORDER_STATUS.DELIVERED]:   'Delivered',
  [ORDER_STATUS.RTO]:         'RTO',
  [ORDER_STATUS.CANCELLED]:   'Cancelled',
}

/**
 * Statuses that earn revenue. Revenue is recognised on delivery, and these
 * orders are selected by `delivered_at`, not `order_date`.
 */
export const REVENUE_STATUSES = [ORDER_STATUS.DELIVERED]

/**
 * Orders still moving through fulfilment. They earn no revenue yet but they do
 * incur costs, and they must stay visible in operational counts — leaving
 * 'unfulfilled' out of this list is what made 9 orders invisible to the whole app.
 * Selected by `order_date`.
 */
export const IN_FLIGHT_STATUSES = [ORDER_STATUS.UNFULFILLED, ORDER_STATUS.ACTIVE]

/** Orders that ended without delivering. Costs may still apply (notably RTO fees). */
export const TERMINATED_STATUSES = [ORDER_STATUS.RTO, ORDER_STATUS.CANCELLED]

/**
 * Every status a P&L date range should consider, other than delivered.
 * Selected by `order_date`.
 */
export const NON_DELIVERED_STATUSES = [...IN_FLIGHT_STATUSES, ...TERMINATED_STATUSES]

/** COD cash sitting with the courier — only these are genuinely in transit. */
export const COD_FLOAT_STATUSES = [ORDER_STATUS.ACTIVE]

export function isValidOrderStatus(status) {
  return ORDER_STATUS_LIST.includes(status)
}

// ── Payment type ────────────────────────────────────────────────────────────

export const PAYMENT_TYPE = {
  COD:              'cash_on_delivery',
  PREPAID_CASHFREE: 'prepaid_cashfree',
  PREPAID_RAZORPAY: 'prepaid_razorpay',
  UNKNOWN:          'unknown',
}

export const PAYMENT_TYPE_LIST = Object.values(PAYMENT_TYPE)

export const PAYMENT_TYPE_LABELS = {
  [PAYMENT_TYPE.COD]:              'COD',
  [PAYMENT_TYPE.PREPAID_CASHFREE]: 'Cashfree',
  [PAYMENT_TYPE.PREPAID_RAZORPAY]: 'Razorpay',
  [PAYMENT_TYPE.UNKNOWN]:          'Unknown',
}

export const PREPAID_TYPES = [PAYMENT_TYPE.PREPAID_CASHFREE, PAYMENT_TYPE.PREPAID_RAZORPAY]

export function isPrepaid(paymentType) {
  return PREPAID_TYPES.includes(paymentType)
}

// ── Fee rates ───────────────────────────────────────────────────────────────
// Kept here so the checkout and gateway fees have one definition shared by the
// Shopify sync, the P&L route and the GST route.

export const GST_RATE_PCT           = 18
export const CHECKOUT_FEE_RATE      = 0.02  // Fastrr/Shopify checkout, GST added on top
export const CASHFREE_FEE_RATE      = 0.025 // payment gateway, prepaid only, GST on top

export const COST_SOURCE = {
  VFULFILL: 'vfulfill',
  FASTRR:   'fastrr',
  CASHFREE: 'cashfree',
}
