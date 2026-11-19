import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { decide, isAllowed, MACHINE_PATHS } from '@/lib/auth/gate'

/**
 * The login gate (Next 16 calls middleware "proxy"). Every page and every /api route needs a Supabase Auth
 * session whose email is in AUTH_ALLOWED_EMAILS; the Shopify webhook alone is exempt (it checks its HMAC).
 * The pages also check on the server (src/lib/auth/server.ts), so this is not the only line.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  // A machine endpoint needs no session lookup.
  if (MACHINE_PATHS.includes(pathname)) return NextResponse.next()

  // Cookies and no-cache headers Supabase asks to set (a refreshed or cleared session). They go on whatever response
  // is sent, redirect and 401 included: dropping them makes the browser resend a used refresh token and get signed out.
  const pendingCookies = new Map<string, { name: string; value: string; options: CookieOptions }>()
  const pendingHeaders: Record<string, string> = {}
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const c of cookiesToSet) {
          request.cookies.set(c.name, c.value) // so the page handling this request sees the new session too
          pendingCookies.set(c.name, c)
        }
        Object.assign(pendingHeaders, headers)
      },
    },
  })
  // getUser() verifies the token with Supabase; getSession() only decodes the cookie and would trust a forged one.
  const { data: { user } } = await supabase.auth.getUser()
  const d = decide(pathname, search, isAllowed(user?.email, process.env.AUTH_ALLOWED_EMAILS))

  const send = (res: NextResponse) => {
    for (const { name, value, options } of pendingCookies.values()) res.cookies.set(name, value, options)
    for (const [k, v] of Object.entries(pendingHeaders)) res.headers.set(k, v)
    return res
  }
  switch (d.kind) {
    case 'pass': return send(NextResponse.next({ request }))
    case 'unauthorized': return send(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    case 'home': return send(NextResponse.redirect(new URL('/', request.url)))
    case 'login': {
      const url = new URL('/login', request.url)
      if (d.next) url.searchParams.set('next', d.next)
      return send(NextResponse.redirect(url))
    }
  }
}

export const config = {
  // Everything but Next internals and static files. API routes are included on purpose: they are what this closes.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
