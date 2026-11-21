import { describe, expect, it } from 'vitest'
import { decide, isAllowed, safeNext } from './gate'

describe('isAllowed', () => {
  it('matches the list case-insensitively, ignoring spaces', () => {
    expect(isAllowed('Owner@Example.com', ' owner@example.com , second@example.com')).toBe(true)
    expect(isAllowed('stranger@example.com', 'owner@example.com')).toBe(false)
  })
  it('fails closed: no list, or no email, lets nobody in', () => {
    expect(isAllowed('owner@example.com', undefined)).toBe(false)
    expect(isAllowed('owner@example.com', ' , ')).toBe(false)
    expect(isAllowed(null, 'owner@example.com')).toBe(false)
  })
})

describe('safeNext', () => {
  it('refuses the control-character tricks a browser strips (Codex: /<tab>/evil.example)', () => {
    const c = String.fromCharCode
    for (const bad of [`/${c(9)}/evil.example`, `/${c(10)}/evil.example`, `/${c(13)}/evil.example`, `${c(9)}//evil.example`, `/${c(92)}${c(9)}evil.example`, `/${c(92)}${c(92)}evil.example`]) {
      expect(safeNext(bad), JSON.stringify(bad)).toBe('/')
    }
  })

  it('refuses paths that become "//host" once dot segments are cleaned up (Codex: /.//evil.example)', () => {
    for (const bad of ['/.//evil.example', '/..//evil.example', '/a/..//evil.example', '/././/evil.example']) expect(safeNext(bad), bad).toBe('/')
    expect(safeNext('/a/../money')).toBe('/money') // a harmless dot segment still resolves on this site
  })

  it('an encoded slash stays a path on this site, never a host', () => {
    expect(safeNext('/%2F%2Fevil.example')).toBe('/%2F%2Fevil.example')
    expect(safeNext('/%09/evil.example')).toBe('/%09/evil.example')
  })

  it('keeps a same-site path with its query and hash', () => {
    expect(safeNext('/money?store=oorvia#cash')).toBe('/money?store=oorvia#cash')
  })

  it('keeps a same-site path, refuses anything that leaves the site', () => {
    expect(safeNext('/money?store=oorvia')).toBe('/money?store=oorvia')
    for (const bad of ['//evil.com', `/${String.fromCharCode(92)}evil.com`, 'https://evil.com', 'javascript:alert(1)', 'evil', '', null, undefined]) expect(safeNext(bad), String(bad)).toBe('/')
  })
})

describe('decide', () => {
  it('signed out: pages go to /login with where they were going, API answers 401', () => {
    expect(decide('/money', '?store=oorvia', false)).toEqual({ kind: 'login', next: '/money?store=oorvia' })
    expect(decide('/', '', false)).toEqual({ kind: 'login', next: null })
    expect(decide('/api/sync/meta', '', false)).toEqual({ kind: 'unauthorized' })
    expect(decide('/auth/signout', '', false)).toEqual({ kind: 'login', next: null }) // POST-only: not a page to return to
  })
  it('the login page is open signed out, and sends a signed-in user home', () => {
    expect(decide('/login', '', false)).toEqual({ kind: 'pass' })
    expect(decide('/login', '', true)).toEqual({ kind: 'home' })
  })
  it('only the Shopify webhook, the Meta cron and the owner-share read are exempt, and only exactly', () => {
    expect(decide('/api/owner-share', '', false)).toEqual({ kind: 'pass' })
    expect(decide('/api/owner-share/x', '', false)).toEqual({ kind: 'unauthorized' })
    expect(decide('/api/webhooks/shopify', '', false)).toEqual({ kind: 'pass' })
    expect(decide('/api/webhooks/shopify/x', '', false)).toEqual({ kind: 'unauthorized' })
    expect(decide('/api/webhooks', '', false)).toEqual({ kind: 'unauthorized' })
    expect(decide('/api/cron/meta', '', false)).toEqual({ kind: 'pass' })
    expect(decide('/api/cron/meta/x', '', false)).toEqual({ kind: 'unauthorized' })
    expect(decide('/api/cron', '', false)).toEqual({ kind: 'unauthorized' })
    expect(decide('/api/sync/meta', '', false)).toEqual({ kind: 'unauthorized' })
  })
  it('signed in: everything passes', () => {
    for (const p of ['/', '/money', '/api/sync/meta']) expect(decide(p, '', true)).toEqual({ kind: 'pass' })
  })
  it('a lookalike of the login path is not public', () => {
    expect(decide('/loginx', '', false)).toEqual({ kind: 'login', next: '/loginx' })
  })
})

describe('safeNext, exhaustively', () => {
  it('whatever it returns, the browser resolves to this site (every mix of the tricky pieces, up to 5 long)', () => {
    const c = String.fromCharCode
    const pieces = ['/', c(92), '.', c(9), c(10), '%2F', 'evil.example', '@', ':', '?', '#']
    const base = 'https://dash.example'
    let checked = 0
    const walk = (s: string, depth: number) => {
      if (s) {
        const out = safeNext(s)
        checked++
        expect(new URL(out, base).origin, JSON.stringify(s)).toBe(base)
        expect(out.startsWith('/') && !out.startsWith('//'), JSON.stringify(s)).toBe(true)
      }
      if (depth < 5) for (const p of pieces) walk(s + p, depth + 1)
    }
    walk('', 0)
    expect(checked).toBeGreaterThan(170_000)
  }, 30_000) // ~180,000 cases: ~3 s alone, up to ~10 s beside the rest of the suite
})
