import { describe, expect, it } from 'vitest'
import { selectAll } from './paged'

/**
 * A fake PostgREST builder over `total` rows, counting the pages asked for. `counts`: it has setHeader and reports
 * the total when asked, as the real builder does. `grow`: rows added to the table after the first page is read.
 */
function fake(total: number, opts: { cap?: number; failAt?: number; counts?: boolean; grow?: number } = {}) {
  const calls: [number, number][] = []
  const inFlight = { now: 0, max: 0 }
  const build = () => {
    let wantCount = false
    return {
      ...(opts.counts ? { setHeader: (name: string, value: string) => { wantCount = name === 'Prefer' && value === 'count=exact' } } : {}),
      range: async (from: number, to: number) => {
        const size = total + (calls.length > 0 ? opts.grow ?? 0 : 0)
        calls.push([from, to])
        inFlight.now++
        inFlight.max = Math.max(inFlight.max, inFlight.now)
        await new Promise((r) => setTimeout(r, 0))
        inFlight.now--
        if (opts.failAt !== undefined && from >= opts.failAt) return { data: null, error: { message: 'boom' } }
        const end = Math.min(to + 1, from + (opts.cap ?? Infinity), size)
        return { data: Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i), error: null, count: wantCount ? size : null }
      },
    }
  }
  return { build, calls, inFlight }
}

describe('selectAll', () => {
  it('reads 2.5 pages and stops on the empty page', async () => {
    const f = fake(2500)
    const rows = await selectAll<number>(f.build)
    expect(rows).toHaveLength(2500)
    expect(rows[2499]).toBe(2499)
    expect(f.calls).toHaveLength(4)
  })

  it('reads exactly one full page without losing or duplicating rows', async () => {
    const f = fake(1000)
    expect(await selectAll<number>(f.build)).toHaveLength(1000)
    expect(f.calls).toHaveLength(2)
  })

  it('does not skip rows when the server caps pages below the page size', async () => {
    const rows = await selectAll<number>(fake(1300, { cap: 500 }).build)
    expect(rows).toEqual(Array.from({ length: 1300 }, (_, i) => i))
  })

  it('returns nothing for an empty table', async () => {
    expect(await selectAll<number>(fake(0).build)).toEqual([])
  })

  it('surfaces errors, even mid-read', async () => {
    await expect(selectAll<number>(fake(2500, { failAt: 1000 }).build)).rejects.toThrow('boom')
  })

  describe('with a count', () => {
    const all = (k: number) => Array.from({ length: k }, (_, i) => i)

    it('reads a table that fits in one page in one round trip', async () => {
      const f = fake(400, { counts: true })
      expect(await selectAll<number>(f.build)).toEqual(all(400))
      expect(f.calls).toHaveLength(1)
    })

    it('probes once past exactly one full page, as rows may have been added after it', async () => {
      const f = fake(1000, { counts: true })
      expect(await selectAll<number>(f.build)).toEqual(all(1000))
      expect(f.calls).toEqual([[0, 999], [1000, 1999]])
    })

    it('fetches the remaining pages in parallel, no empty page', async () => {
      const f = fake(3333, { counts: true })
      expect(await selectAll<number>(f.build)).toEqual(all(3333))
      expect(f.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999], [3000, 3999]])
    })

    it('pages by the server cap when it is below the page size', async () => {
      const f = fake(1300, { counts: true, cap: 500 })
      expect(await selectAll<number>(f.build)).toEqual(all(1300))
      expect(f.calls).toEqual([[0, 999], [500, 999], [1000, 1499]])
    })

    it('falls back to paging one by one when rows change mid-read, losing none', async () => {
      const f = fake(2500, { counts: true, grow: 7 })
      expect(await selectAll<number>(f.build)).toEqual(all(2507))
    })

    it('reads rows added at the end when the counted pages all come back full', async () => {
      const f = fake(2000, { counts: true, grow: 7 })
      expect(await selectAll<number>(f.build)).toEqual(all(2007))
    })

    it('keeps at most 4 pages of one read in flight', async () => {
      const f = fake(10_500, { counts: true })
      expect(await selectAll<number>(f.build)).toEqual(all(10_500))
      expect(f.inFlight.max).toBe(4)
      expect(f.calls).toHaveLength(11)
    })

    it('returns nothing for an empty table', async () => {
      expect(await selectAll<number>(fake(0, { counts: true }).build)).toEqual([])
    })

    it('surfaces errors from a parallel page', async () => {
      await expect(selectAll<number>(fake(2500, { counts: true, failAt: 1000 }).build)).rejects.toThrow('boom')
    })
  })
})
