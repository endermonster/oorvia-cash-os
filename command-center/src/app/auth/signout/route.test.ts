import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ calls: [] as (string | undefined)[], globalFails: false }))
vi.mock('@/lib/auth/server', () => ({
  authClient: async () => ({
    auth: {
      signOut: async (opts?: { scope?: string }) => {
        h.calls.push(opts?.scope)
        return { error: opts?.scope === undefined && h.globalFails ? { message: 'fetch failed' } : null }
      },
    },
  }),
}))
const { POST } = await import('./route')
const post = () => POST(new Request('http://localhost:3018/auth/signout', { method: 'POST' }))

beforeEach(() => { h.calls = []; h.globalFails = false; vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('POST /auth/signout', () => {
  it('revokes the session and goes to /login', async () => {
    const res = await post()
    expect(h.calls).toEqual([undefined])
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('http://localhost:3018/login')
  })

  it('if Supabase cannot revoke (Codex review 4), still clears this browser and goes to /login', async () => {
    h.globalFails = true
    const res = await post()
    expect(h.calls).toEqual([undefined, 'local'])
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('http://localhost:3018/login')
  })
})
