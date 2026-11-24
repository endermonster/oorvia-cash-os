/**
 * The login gate's decisions, pure so they can be tested without Next or Supabase. `proxy.ts` and the
 * server-side check (`./server.ts`) both use these, so a path missed by one is still caught by the other.
 *
 * Single user: a session only counts when its email is in AUTH_ALLOWED_EMAILS (comma-separated). An empty or
 * missing list lets nobody in: the gate fails closed, so a deploy without the variable shows no data.
 */

/** Pages reachable without a session. */
export const PUBLIC_PAGES = ['/login']

/**
 * Machine endpoints that authenticate themselves, matched exactly. Shopify's webhook checks its HMAC
 * signature (src/app/api/webhooks/shopify/route.ts); the daily Meta cron checks CRON_SECRET
 * (src/app/api/cron/meta/route.ts); the funds check checks FUNDS_CRON_SECRET (src/app/api/cron/meta-funds/route.ts);
 * the finance app's owner-share read checks OWNER_SHARE_SECRET
 * (src/app/api/owner-share/route.ts). Nothing else is exempt.
 */
export const MACHINE_PATHS = ['/api/webhooks/shopify', '/api/cron/meta', '/api/cron/meta-funds', '/api/owner-share']

export function allowedEmails(raw: string | undefined): Set<string> {
  return new Set((raw ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))
}

export function isAllowed(email: string | null | undefined, raw: string | undefined): boolean {
  if (!email) return false
  return allowedEmails(raw).has(email.trim().toLowerCase())
}

/** A base no real request uses: whatever `next` resolves to must keep exactly this origin. */
const BASE = 'https://gate.invalid'

/**
 * Where to go after signing in: a path on this site only. `next` is resolved the way the browser will resolve it
 * (which strips tabs and newlines and reads a backslash as a slash, so "/<tab>/evil.com" becomes "//evil.com"),
 * then kept only if it stays on this site. The resolved form is returned, so the browser goes exactly where was checked.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/')) return '/'
  let url: URL
  try { url = new URL(next, BASE) } catch { return '/' }
  if (url.origin !== BASE) return '/'
  const out = `${url.pathname}${url.search}${url.hash}`
  // Cleaning up dot segments can itself produce "//host" ("/.//evil.com" → "//evil.com"): the result must be a
  // single-slash path that still resolves to this site when the browser reads it again.
  if (!out.startsWith('/') || out.startsWith('//')) return '/'
  try { if (new URL(out, BASE).origin !== BASE) return '/' } catch { return '/' }
  return out
}

export type GateDecision =
  | { kind: 'pass' }
  /** API request with no allowed session. */
  | { kind: 'unauthorized' }
  /** Page request with no allowed session: send to /login, coming back to `next` after. */
  | { kind: 'login'; next: string | null }
  /** Signed in and asking for the login page: nothing to do there. */
  | { kind: 'home' }

const isPublic = (p: string) => PUBLIC_PAGES.some((x) => p === x || p.startsWith(`${x}/`))

export function decide(pathname: string, search: string, signedIn: boolean): GateDecision {
  if (MACHINE_PATHS.includes(pathname)) return { kind: 'pass' }
  if (signedIn) return isPublic(pathname) ? { kind: 'home' } : { kind: 'pass' }
  if (pathname.startsWith('/api/')) return { kind: 'unauthorized' }
  if (isPublic(pathname)) return { kind: 'pass' }
  // /auth/* are POST-only actions (sign out): never a place to come back to.
  return { kind: 'login', next: (pathname === '/' && !search) || pathname.startsWith('/auth/') ? null : pathname + search }
}
