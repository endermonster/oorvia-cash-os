import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Cookie-aware anon client used only to read the signed-in user in Server
// Components and route handlers. Never use this for data access — it is subject
// to RLS by design. Data access goes through lib/supabase.js.
export async function createSupabaseAuthClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — the proxy refreshes the session,
            // so this is safe to ignore.
          }
        },
      },
    }
  )
}

// Returns the authenticated user, or null. Verifies the JWT with Supabase
// rather than trusting the cookie contents.
export async function getUser() {
  const supabase = await createSupabaseAuthClient()
  const { data, error } = await supabase.auth.getUser()
  if (error) return null
  return data.user ?? null
}
