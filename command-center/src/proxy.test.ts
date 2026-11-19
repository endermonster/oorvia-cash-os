import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A Supabase client whose getUser() refreshes (or clears) the session, the way @supabase/ssr does through setAll.
const h = vi.hoisted(() => ({
  user: null as { email: string } | null,
  refresh: null as { name: string; value: string } | null,
}))
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: { setAll: (c: { name: string; value: string; options: object }[], headers: Record<string, string>) => void } }) => ({
    auth: {
      getUser: async () => {
        if (h.refresh) opts.cookies.setAll([{ ...h.refresh, options: { path: '/', httpOnly: true } }], { 'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0' })
        return { data: { user: h.user } }
      },
    },
  }),
}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
process.env.AUTH_ALLOWED_EMAILS = 'owner@example.com'
const { proxy } = await import('./proxy')

const req = (path: string, method = 'GET') => new NextRequest(new URL(path, 'http://localhost:3018'), { method })
const setCookie = (res: Response) => res.headers.get('set-cookie') ?? ''

beforeEach(() => { h.user = null; h.refresh = null })

describe('proxy keeps a refreshed session on every kind of response (Codex review 3)', () => {
  it('signed in on /login: the redirect home carries the new cookie and the no-cache header', async () => {
    h.user = { email: 'owner@example.com' }
    h.refresh = { name: 'sb-x-auth-token', value: 'NEW' }
    const res = await proxy(req('/login'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3018/')
    expect(setCookie(res)).toContain('sb-x-auth-token=NEW')
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('a page that passes carries it too', async () => {
    h.user = { email: 'owner@example.com' }
    h.refresh = { name: 'sb-x-auth-token', value: 'NEW' }
    const res = await proxy(req('/money'))
    expect(res.status).toBe(200)
    expect(setCookie(res)).toContain('sb-x-auth-token=NEW')
  })

  it('a cleared session reaches the browser on the 401 and on the login redirect', async () => {
    h.refresh = { name: 'sb-x-auth-token', value: '' }
    const api = await proxy(req('/api/sync/meta', 'POST'))
    expect(api.status).toBe(401)
    expect(setCookie(api)).toContain('sb-x-auth-token=')
    const page = await proxy(req('/money?store=oorvia'))
    expect(page.headers.get('location')).toBe('http://localhost:3018/login?next=%2Fmoney%3Fstore%3Doorvia')
    expect(setCookie(page)).toContain('sb-x-auth-token=')
  })

  it('no refresh: no cookie is set', async () => {
    h.user = { email: 'owner@example.com' }
    expect(setCookie(await proxy(req('/')))).toBe('')
  })

  it('a signed-in email not on the list is treated as signed out', async () => {
    h.user = { email: 'stranger@example.com' }
    expect((await proxy(req('/api/sync/meta', 'POST'))).status).toBe(401)
  })

  it('the Shopify webhook skips the session lookup', async () => {
    h.refresh = { name: 'sb-x-auth-token', value: 'NEW' }
    const res = await proxy(req('/api/webhooks/shopify', 'POST'))
    expect(res.status).toBe(200)
    expect(setCookie(res)).toBe('')
  })
})
