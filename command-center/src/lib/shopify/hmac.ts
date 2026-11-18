import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verifies a Shopify webhook: the `X-Shopify-Hmac-Sha256` header is the base64 HMAC-SHA256 of the
 * RAW request body, keyed with the app's client secret. Constant-time comparison.
 */
export function verifyShopifyHmac(rawBody: string | Uint8Array, header: string | null | undefined, secret: string): boolean {
  if (!header || !secret) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest()
  const given = Buffer.from(header, 'base64')
  // timingSafeEqual throws on a length mismatch, so compare lengths first (length is not secret).
  return given.length === expected.length && timingSafeEqual(given, expected)
}
