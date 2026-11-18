/**
 * A failed Supabase call that keeps PostgREST's error code and HTTP status, so a caller can tell a temporary
 * failure (timeout, connection trouble, overload) from one that will fail the same way again (bad data).
 * The webhook uses this to answer 500 (Shopify redelivers) only when a retry could help.
 */
export class DbError extends Error {
  readonly transient: boolean
  constructor(message: string, readonly code: string | undefined, readonly status: number | undefined) {
    super(message)
    this.name = 'DbError'
    this.transient = isRetryableDb(code, status, message)
  }
}

/** HTTP statuses worth a retry. 0 is supabase-js's status when the request never got a response. */
const RETRY_STATUS = new Set([0, 408, 429, 502, 503, 504])

/**
 * Postgres SQLSTATEs and PostgREST codes worth a retry: statement timeout (57014), serialization failure (40001),
 * deadlock (40P01), lock not available (55P03), and PostgREST's connection and pool errors (PGRST000–003).
 * Whole classes: 08 connection exception, 53 insufficient resources, 57P server shutting down or starting.
 */
const RETRY_CODES = new Set(['57014', '40001', '40P01', '55P03', 'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'])
const RETRY_CLASSES = /^(08|53|57P)/

const NETWORK_MESSAGE = /fetch failed|network|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up/i

export function isRetryableDb(code: string | undefined, status: number | undefined, message = ''): boolean {
  if (status !== undefined && RETRY_STATUS.has(status)) return true
  if (code && (RETRY_CODES.has(code) || RETRY_CLASSES.test(code))) return true
  return NETWORK_MESSAGE.test(message)
}

/** A supabase-js `{ error, status }` as a DbError. `label` names the table or function. */
export function dbError(label: string, error: { message: string; code?: string }, status?: number): DbError {
  return new DbError(`${label}: ${error.message}`, error.code || undefined, status)
}
