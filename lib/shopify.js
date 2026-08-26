/**
 * Shared Shopify order logic used by both the CSV import and the webhook sync.
 *
 * Both mappers return values from `lib/constants` — never bare string literals.
 * The status and payment_type vocabularies live there so the filters, badges,
 * P&L and these mappers cannot drift apart again.
 */

import { ORDER_STATUS, PAYMENT_TYPE } from '@/lib/constants'

/**
 * Maps Shopify order fields to our internal status enum.
 *
 * cancelled_at set + fulfilled → RTO        (shipped, came back)
 * cancelled_at set + unfulfilled → CANCELLED (demand test / dropped before shipping)
 * voided → CANCELLED
 * fulfilled (not cancelled) → ACTIVE
 * anything else → UNFULFILLED               (placed, not yet shipped)
 */
export function mapShopifyStatus(financialStatus, fulfillmentStatus, cancelledAt) {
  if (cancelledAt || (financialStatus || '').toLowerCase() === 'voided') {
    return fulfillmentStatus === 'fulfilled' ? ORDER_STATUS.RTO : ORDER_STATUS.CANCELLED
  }
  if (fulfillmentStatus === 'fulfilled') return ORDER_STATUS.ACTIVE
  return ORDER_STATUS.UNFULFILLED
}

/**
 * Maps the Shopify "Payment Method" CSV column or REST API "payment_gateway"
 * field to our payment_type enum.
 */
export function mapShopifyPaymentMode(value) {
  const v = (value || '').toLowerCase().replace(/[\s_-]/g, '')
  if (v.includes('cod') || v.includes('cashondelivery') || v === 'manual') return PAYMENT_TYPE.COD
  if (v.includes('cashfree')) return PAYMENT_TYPE.PREPAID_CASHFREE
  if (v.includes('razorpay')) return PAYMENT_TYPE.PREPAID_RAZORPAY
  return PAYMENT_TYPE.UNKNOWN
}
