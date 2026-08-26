'use client'

import { createBrowserClient } from '@supabase/ssr'

// Anon-key client for the browser. Only used by the login form — all data reads
// go through API routes, which use the service-role client in lib/supabase.js.
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}
