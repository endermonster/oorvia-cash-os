import { createSupabaseAuthClient } from '@/lib/supabase-auth'

export async function POST(request) {
  const supabase = await createSupabaseAuthClient()
  await supabase.auth.signOut()
  return Response.redirect(new URL('/login', request.url), 303)
}
