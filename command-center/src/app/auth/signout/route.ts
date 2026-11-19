import { NextResponse } from 'next/server'
import { authClient } from '@/lib/auth/server'

/**
 * Ends the session and goes to /login. POST only, so a link or prefetch cannot sign you out.
 *
 * Revokes the session at Supabase (every device). If that call fails (network, Supabase down), it still signs this
 * browser out: scope 'local' clears the session cookies without a network call, so "Sign out" never leaves you in.
 */
export async function POST(request: Request) {
  const sb = await authClient()
  const { error } = await sb.auth.signOut()
  if (error) {
    console.error(`sign out: Supabase revoke failed (${error.message}); clearing this browser's session only`)
    await sb.auth.signOut({ scope: 'local' })
  }
  return NextResponse.redirect(new URL('/login', request.url), 303)
}
