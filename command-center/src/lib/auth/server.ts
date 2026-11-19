import 'server-only'
import { createServerClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { isAllowed } from './gate'

/**
 * Cookie-aware anon client, only to read who is signed in (data reads use the service-role client in
 * ../supabase.ts). Writes cookies where it can: route handlers can, Server Components cannot (the proxy
 * refreshes the session there).
 */
export async function authClient() {
  const store = await cookies()
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => store.set(name, value, options))
        } catch {
          // A Server Component cannot set cookies; the proxy already refreshed the session.
        }
      },
    },
  })
}

/** The signed-in user when their email is allowed, else null. Verifies the token with Supabase (getUser, not getSession). */
export async function allowedUser(): Promise<User | null> {
  const { data, error } = await (await authClient()).auth.getUser()
  if (error || !data.user) return null
  return isAllowed(data.user.email, process.env.AUTH_ALLOWED_EMAILS) ? data.user : null
}

/** For pages: sends anyone not allowed to /login. The second line behind proxy.ts. */
export async function requireUser(): Promise<User> {
  const user = await allowedUser()
  if (!user) redirect('/login')
  return user
}
