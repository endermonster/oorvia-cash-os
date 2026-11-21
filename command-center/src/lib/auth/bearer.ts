import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * `Authorization: Bearer <secret>` check for machine endpoints. Constant-time; hashing first makes both sides
 * the same length. Fails closed: an unset or empty secret matches nothing.
 */
export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false
  const given = createHash('sha256').update(header).digest()
  const want = createHash('sha256').update(`Bearer ${secret}`).digest()
  return timingSafeEqual(given, want)
}
