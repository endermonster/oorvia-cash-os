/**
 * Shared Shopify order logic used by both the CSV import and the webhook sync.
 */

/**
 * Maps Shopify order fields to our internal status enum.
 *
 * cancelled_at set + fulfilled → rto        (shipped, came back)
 * cancelled_at set + unfulfilled → cancelled (demand test / dropped before shipping)
 * voided → cancelled
 * fulfilled (not cancelled) → active
 * anything else → unfulfilled               (placed, not yet shipped)
 */
export function mapShopifyStatus(financialStatus, fulfillmentStatus, cancelledAt) {
  if (cancelledAt || (financialStatus || '').toLowerCase() === 'voided') {
    return fulfillmentStatus === 'fulfilled' ? 'rto' : 'cancelled'
  }
  if (fulfillmentStatus === 'fulfilled') return 'active'
  return 'unfulfilled'
}

/**
 * Maps the Shopify "Payment Method" CSV column or REST API "payment_gateway"
 * field to our payment_type enum.
 */
export function mapShopifyPaymentMode(value) {
  const v = (value || '').toLowerCase().replace(/[\s_-]/g, '')
  if (v.includes('cod') || v.includes('cashondelivery') || v === 'manual') return 'cash_on_delivery'
  if (v.includes('cashfree')) return 'prepaid_cashfree'
  if (v.includes('razorpay')) return 'prepaid_razorpay'
  return 'unknown'
}
