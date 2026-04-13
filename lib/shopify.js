/**
 * Shared Shopify order logic used by both the CSV import and the n8n sync.
 * All filtering and field-mapping decisions live here so there is one source
 * of truth regardless of how orders enter the system.
 */

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

/**
 * Returns true only when an order should enter the accounting DB.
 *
 * Import rule:  financial_status = "paid"  AND  fulfillment_status = "fulfilled"
 * Skip:         voided (cancelled), pending (not confirmed), unfulfilled (not shipped),
 *               restocked (cancelled after fulfillment)
 */
export function shouldImportShopifyOrder(financialStatus, fulfillmentStatus) {
  return financialStatus === 'paid' && fulfillmentStatus === 'fulfilled'
}

// ---------------------------------------------------------------------------
// Payment mode
// ---------------------------------------------------------------------------

/**
 * Maps the Shopify "Payment Method" CSV column or REST API "payment_gateway"
 * field to our payment_mode enum.
 *
 * CSV:  "Cash on Delivery (COD)" → cod | "Cashfree" → prepaid
 * API:  "cod", "manual", "cash-on-delivery" → cod | anything else → prepaid
 */
export function mapShopifyPaymentMode(value) {
  const v = (value || '').toLowerCase().replace(/[\s_-]/g, '')
  if (v.includes('cod') || v.includes('cashondelivery') || v === 'manual') return 'cod'
  return 'prepaid'
}
