import { createClient } from '@supabase/supabase-js'

// Server-side Supabase client. Uses the SERVICE ROLE key, which bypasses RLS —
// it must never reach the browser. Every importer of this module is an API route
// under app/api/; if you need Supabase in a client component, use
// lib/supabase-browser.js (anon key) instead.
if (typeof window !== 'undefined') {
  throw new Error('lib/supabase.js is server-only — import lib/supabase-browser.js in client components')
}

let client = null

function getClient() {
  if (client) return client

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Copy it from Supabase → Project Settings → API → service_role, ' +
      'then add it to .env.local and to the Vercel project environment variables.'
    )
  }

  client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return client
}

// Lazy proxy: the client is built on first use, not on import. Constructing it
// at module scope would fail the production build on any machine without the
// key, even though the key is only needed to serve a request.
export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      const value = getClient()[prop]
      return typeof value === 'function' ? value.bind(getClient()) : value
    },
  }
)
