import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Pages reachable without a session.
const PUBLIC_PATHS = ['/login']

// Machine-to-machine endpoints that authenticate with their own shared secret
// (SYNC_SECRET) rather than a user session. Matched exactly — /api/sync/shopify/pull
// is browser-triggered and stays gated.
const MACHINE_API_PATHS = ['/api/sync/shopify']

function isPublicPath(pathname) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export async function proxy(request) {
  const { pathname } = request.nextUrl

  if (MACHINE_API_PATHS.includes(pathname)) return NextResponse.next()

  // Carries any refreshed auth cookies through to the client.
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() verifies the JWT with Supabase. getSession() only decodes the
  // cookie and would trust a forged one — do not swap it in.
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (isPublicPath(pathname)) return response

    const loginUrl = new URL('/login', request.url)
    if (pathname !== '/') loginUrl.searchParams.set('next', pathname + request.nextUrl.search)
    return NextResponse.redirect(loginUrl)
  }

  // Signed in: keep the login page from being a dead end.
  if (isPublicPath(pathname)) {
    return NextResponse.redirect(new URL('/pnl', request.url))
  }

  return response
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets. API routes are
    // deliberately included — they are the exposure this gate exists to close.
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
