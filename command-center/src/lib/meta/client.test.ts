import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { graphGet, graphGetAll, MetaError } = await import('./client')

type MetaErr = InstanceType<typeof MetaError>
/** The error a call is expected to fail with. */
const failed = async (p: Promise<unknown>) => (await p.then(() => { throw new Error('expected a failure') }, (x) => x)) as MetaErr
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const failure = (code: number, message = 'boom', status = 400, extra: object = {}) => json({ error: { message, code, ...extra } }, status)

/** A fetch stub that answers each call from the queue and records URL and headers. */
function stubFetch(answers: (() => Response | Promise<Response>)[]) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string> })
    const next = answers.shift()
    if (!next) throw new Error('unexpected call')
    return next()
  }))
  return calls
}

beforeEach(() => {
  process.env.META_ACCESS_TOKEN = 'SECRET-TOKEN'
  process.env.META_ACCESS_TOKEN_KAIVEN = 'KAIVEN-TOKEN'
  process.env.META_ACCESS_TOKEN_SELNOVA = 'SELNOVA-TOKEN'
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('graphGet', () => {
  it('sends the token in a header, not the URL', async () => {
    const calls = stubFetch([() => json({ name: 'x' })])
    await expect(graphGet('act_1338726490985485', { fields: 'name' })).resolves.toEqual({ name: 'x' })
    expect(calls[0].url).toBe('https://graph.facebook.com/v27.0/act_1338726490985485?fields=name')
    expect(calls[0].url).not.toContain('SECRET-TOKEN')
    expect(calls[0].headers.Authorization).toBe('Bearer SECRET-TOKEN')
  })

  it('retries a rate limit (code 17) and returns the next good answer', async () => {
    vi.useFakeTimers()
    stubFetch([() => failure(17, 'rate limited', 400), () => json({ ok: 1 })])
    const p = graphGet('act_1338726490985485')
    await vi.advanceTimersByTimeAsync(2000)
    await expect(p).resolves.toEqual({ ok: 1 })
  })

  it('retries HTTP 5xx and an is_transient flag', async () => {
    vi.useFakeTimers()
    stubFetch([() => json({}, 503), () => failure(99, 'odd', 400, { is_transient: true }), () => json({ ok: 1 })])
    const p = graphGet('act_1338726490985485')
    await vi.advanceTimersByTimeAsync(2000 + 4000)
    await expect(p).resolves.toEqual({ ok: 1 })
  })

  it('gives up after the tries as transient', async () => {
    vi.useFakeTimers()
    stubFetch(Array.from({ length: 6 }, () => () => json({}, 500)))
    const p = failed(graphGet('act_1338726490985485'))
    await vi.advanceTimersByTimeAsync(120000)
    const e = await p
    expect(e).toBeInstanceOf(MetaError)
    expect((e).transient).toBe(true)
    expect((e as Error).message).toMatch(/gave up after 6 tries/)
  })

  it('treats a bad token (190) as permanent and never retries', async () => {
    const calls = stubFetch([() => failure(190, 'Invalid OAuth access_token=SECRET-TOKEN', 401)])
    const e = await failed(graphGet('act_1338726490985485'))
    expect(e).toBeInstanceOf(MetaError)
    expect(e.kind).toBe('auth')
    expect((e).transient).toBe(false)
    expect(calls).toHaveLength(1)
    expect(e.message).not.toContain('SECRET-TOKEN')
  })

  it('treats 200 and 10 as permanent no-access', async () => {
    for (const code of [200, 10]) {
      const calls = stubFetch([() => failure(code, 'Ad account owner has NOT grant ads_management or ads_read permission', 403)])
      const e = await failed(graphGet('act_1338726490985485'))
      expect(e.kind).toBe('no_access')
      expect((e).transient).toBe(false)
      expect(calls).toHaveLength(1)
    }
  })

  it('treats another 4xx as permanent', async () => {
    stubFetch([() => failure(100, 'Invalid parameter')])
    const e = await failed(graphGet('act_1338726490985485'))
    expect(e.kind).toBe('other')
    expect((e).transient).toBe(false)
  })

  it('reports a network failure as transient', async () => {
    vi.useFakeTimers()
    stubFetch(Array.from({ length: 6 }, () => () => { throw new TypeError('fetch failed') }))
    const p = failed(graphGet('act_1338726490985485'))
    await vi.advanceTimersByTimeAsync(120000)
    expect((await p).transient).toBe(true)
  })
})

describe('graphGetAll', () => {
  it('follows paging.next and concatenates the pages', async () => {
    const calls = stubFetch([
      () => json({ data: [1, 2], paging: { next: 'https://graph.facebook.com/v27.0/act_1338726490985485/campaigns?after=A' } }),
      () => json({ data: [3] }),
    ])
    await expect(graphGetAll<number>('act_1338726490985485/campaigns', { limit: 2 })).resolves.toEqual([1, 2, 3])
    expect(calls[1].url).toContain('after=A')
  })

  it('refuses a paging URL on another host, so the token is never sent there', async () => {
    stubFetch([() => json({ data: [1], paging: { next: 'https://evil.example/x' } })])
    await expect(graphGetAll('act_1338726490985485/campaigns')).rejects.toThrow(/refused/)
  })
})

const ACT = 'act_1338726490985485'

describe('transient classification', () => {
  it.each([4, 341, 613, 80000, 80007, 80014])('retries Meta error code %i', async (code) => {
    vi.useFakeTimers()
    stubFetch([() => failure(code, 'slow down'), () => json({ ok: 1 })])
    const p = graphGet(ACT)
    await vi.advanceTimersByTimeAsync(2000)
    await expect(p).resolves.toEqual({ ok: 1 })
  })

  it('does not retry the codes just outside the rate-limit range', async () => {
    const calls = stubFetch([() => failure(80015, 'no')])
    const e = await failed(graphGet(ACT))
    expect(e.transient).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('honours Retry-After on a 429', async () => {
    vi.useFakeTimers()
    stubFetch([() => new Response('{}', { status: 429, headers: { 'retry-after': '7' } }), () => json({ ok: 1 })])
    const p = graphGet(ACT)
    await vi.advanceTimersByTimeAsync(6000)
    expect(fetch).toHaveBeenCalledTimes(1) // 2 s backoff would have retried by now
    await vi.advanceTimersByTimeAsync(1500)
    await expect(p).resolves.toEqual({ ok: 1 })
  })
})

describe('timeout and deadline', () => {
  it('aborts a request that outlives the per-request timeout, as transient', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_r, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))))
    const p = failed(graphGet(ACT, {}, { timeoutMs: 1000, deadlineAt: Date.now() + 1500 }))
    await vi.advanceTimersByTimeAsync(1000)
    const e = await p
    expect(e.transient).toBe(true)
    expect(e.message).toMatch(/timed out/)
  })

  it('does not back off past the deadline: gives up, transient', async () => {
    const calls = stubFetch([() => json({}, 503)])
    const e = await failed(graphGet(ACT, {}, { deadlineAt: Date.now() + 500 }))
    expect(e.transient).toBe(true)
    expect(e.message).toMatch(/gave up after 1 try$/)
    expect(calls).toHaveLength(1)
  })

  it('fails fast when the deadline has already passed, without calling fetch', async () => {
    const calls = stubFetch([])
    const e = await failed(graphGet(ACT, {}, { deadlineAt: Date.now() - 1 }))
    expect(e.message).toMatch(/out of time/)
    expect(calls).toHaveLength(0)
  })

  it('names the tries in the gave-up message', async () => {
    vi.useFakeTimers()
    stubFetch(Array.from({ length: 6 }, () => () => json({}, 500)))
    const p = failed(graphGet(ACT))
    await vi.advanceTimersByTimeAsync(120000)
    expect((await p).message).toMatch(/HTTP 500\), gave up after 6 tries$/)
  })
})

describe('allowlist', () => {
  it('refuses me/adaccounts and a non-allowlisted account without calling fetch', async () => {
    const calls = stubFetch([])
    for (const path of ['me/adaccounts', 'me/businesses', 'act_111111111111111', 'act_13387264909854850']) {
      const e = await failed(graphGet(path))
      expect(e.transient).toBe(false)
      expect(e.message).toMatch(/refused/)
    }
    expect(calls).toHaveLength(0)
  })

  it('refuses a paging URL that points elsewhere', async () => {
    stubFetch([() => json({ data: [1], paging: { next: 'https://graph.facebook.com/v27.0/me/adaccounts?after=A' } })])
    await expect(graphGetAll(`${ACT}/campaigns`)).rejects.toThrow(/refused/)
  })

  it.each([
    ['another port', `https://graph.facebook.com:8443/v27.0/${ACT}/campaigns?after=A`],
    ['user info', `https://user:pw@graph.facebook.com/v27.0/${ACT}/campaigns?after=A`],
    ['plain http', `http://graph.facebook.com/v27.0/${ACT}/campaigns?after=A`],
    ['a look-alike host', `https://graph.facebook.com.evil.example/v27.0/${ACT}/campaigns?after=A`],
    ['path traversal', `https://graph.facebook.com/v27.0/${ACT}/../../me/adaccounts`],
    ['encoded path traversal', `https://graph.facebook.com/v27.0/${ACT}/%2e%2e/%2E%2E/me/adaccounts`],
    ['a longer account ID', 'https://graph.facebook.com/v27.0/act_13387264909854851/campaigns'],
  ])('refuses a paging URL with %s, sending nothing', async (_why, next) => {
    const calls = stubFetch([() => json({ data: [1], paging: { next } })])
    await expect(graphGetAll(`${ACT}/campaigns`)).rejects.toThrow(/refused/)
    expect(calls).toHaveLength(1)
  })

  it('refuses a traversal in the path it is given', async () => {
    const calls = stubFetch([])
    await expect(graphGet(`${ACT}/../../me/adaccounts`)).rejects.toThrow(/refused/)
    expect(calls).toHaveLength(0)
  })

  it('refuses redirects', async () => {
    const calls = stubFetch([() => json({ ok: 1 })])
    await graphGet(ACT)
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ redirect: 'error' })
    expect(calls).toHaveLength(1)
  })
})

describe('pagination bounds', () => {
  it('throws, permanently, when a next URL repeats', async () => {
    const next = `https://graph.facebook.com/v27.0/${ACT}/campaigns?after=A`
    stubFetch([() => json({ data: [1], paging: { next } }), () => json({ data: [2], paging: { next } }), () => json({ data: [3], paging: { next } })])
    const e = await failed(graphGetAll(`${ACT}/campaigns`))
    expect(e.transient).toBe(false)
    expect(e.message).toMatch(/loops/)
  })

  it('stops at 500 pages', async () => {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [1], paging: { next: `https://graph.facebook.com/v27.0/${ACT}/campaigns?after=${++n}` } })))
    const e = await failed(graphGetAll(`${ACT}/campaigns`))
    expect(e.message).toMatch(/more than 500 pages/)
  })
})

const KAIVEN = 'act_1874064503928537'
const SELNOVA = 'act_959242917044218'
const OORVIA2 = 'act_1447663743539549'
const page = (act: string, after: string) => `https://graph.facebook.com/v27.0/${act}/insights?after=${after}`
const bearer = (calls: { headers: Record<string, string> }[]) => calls.map((c) => c.headers.Authorization)

describe('token per business portfolio', () => {
  it('sends each allowlisted account its own portfolio token; both Oorvia accounts share META_ACCESS_TOKEN', async () => {
    const calls = stubFetch(Array.from({ length: 4 }, () => () => json({ ok: 1 })))
    for (const act of [KAIVEN, ACT, OORVIA2, SELNOVA]) await graphGet(act)
    expect(bearer(calls)).toEqual(['Bearer KAIVEN-TOKEN', 'Bearer SECRET-TOKEN', 'Bearer SECRET-TOKEN', 'Bearer SELNOVA-TOKEN'])
  })

  it('sends every page of a paged read with the same token', async () => {
    const calls = stubFetch([
      () => json({ data: [1], paging: { next: page(KAIVEN, 'A') } }),
      () => json({ data: [2], paging: { next: page(KAIVEN, 'B') } }),
      () => json({ data: [3] }),
    ])
    await expect(graphGetAll(`${KAIVEN}/insights`)).resolves.toEqual([1, 2, 3])
    expect(bearer(calls)).toEqual(Array(3).fill('Bearer KAIVEN-TOKEN'))
  })

  it('retries with the same token', async () => {
    vi.useFakeTimers()
    const calls = stubFetch([() => json({}, 503), () => json({ data: [1], paging: { next: page(SELNOVA, 'A') } }), () => failure(17), () => json({ data: [2] })])
    const p = graphGetAll(`${SELNOVA}/insights`)
    await vi.advanceTimersByTimeAsync(10000)
    await expect(p).resolves.toEqual([1, 2])
    expect(bearer(calls)).toEqual(Array(4).fill('Bearer SELNOVA-TOKEN'))
  })

  it('keeps tokens apart when two stores sync at the same time', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      seen.push(`${new URL(url).pathname.split('/')[2]} ${(init.headers as Record<string, string>).Authorization}`)
      await new Promise((r) => setTimeout(r, 0))
      const after = new URL(url).searchParams.get('after')
      return json(after ? { data: [after] } : { data: ['first'], paging: { next: page(new URL(url).pathname.split('/')[2], 'next') } })
    }))
    const [k, s] = await Promise.all([graphGetAll(`${KAIVEN}/insights`), graphGetAll(`${SELNOVA}/insights`)])
    expect(k).toEqual(['first', 'next'])
    expect(s).toEqual(['first', 'next'])
    expect(seen.sort()).toEqual([
      `${KAIVEN} Bearer KAIVEN-TOKEN`, `${KAIVEN} Bearer KAIVEN-TOKEN`, `${SELNOVA} Bearer SELNOVA-TOKEN`, `${SELNOVA} Bearer SELNOVA-TOKEN`,
    ])
  })

  it('fails clearly, without calling Meta, when a store token is missing; other stores are unaffected', async () => {
    delete process.env.META_ACCESS_TOKEN_KAIVEN
    const calls = stubFetch([() => json({ ok: 1 })])
    for (const p of [graphGet(KAIVEN), graphGetAll(`${KAIVEN}/campaigns`)]) {
      const e = await failed(p)
      expect(e.kind).toBe('auth')
      expect(e.transient).toBe(false)
      expect(e.message).toBe('META_ACCESS_TOKEN_KAIVEN is not set: it is needed for ad account Kaiven (1874064503928537)')
    }
    expect(calls).toHaveLength(0)
    await expect(graphGet(ACT)).resolves.toEqual({ ok: 1 })
    expect(bearer(calls)).toEqual(['Bearer SECRET-TOKEN'])
  })

  it('never falls back to the Oorvia token for another portfolio', async () => {
    process.env.META_ACCESS_TOKEN_SELNOVA = ''
    const calls = stubFetch([])
    expect((await failed(graphGet(SELNOVA))).message).toMatch(/^META_ACCESS_TOKEN_SELNOVA is not set/)
    expect(calls).toHaveLength(0)
  })

  it('refuses a next URL for another allowlisted account, so a token is never sent to the wrong portfolio', async () => {
    const calls = stubFetch([() => json({ data: [1], paging: { next: page(KAIVEN, 'A') } })])
    const e = await failed(graphGetAll(`${ACT}/insights`))
    expect(e.transient).toBe(false)
    expect(e.message).toMatch(/another ad account was refused/)
    expect(calls).toHaveLength(1)
  })
})
