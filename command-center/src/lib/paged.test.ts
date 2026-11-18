import { describe, expect, it } from 'vitest'
import { selectAll } from './paged'

/** A fake PostgREST builder over `total` rows, counting the pages asked for. */
function fake(total: number, opts: { cap?: number; failAt?: number } = {}) {
  const calls: [number, number][] = []
  const build = () => ({
    range: async (from: number, to: number) => {
      calls.push([from, to])
      if (opts.failAt !== undefined && from >= opts.failAt) return { data: null, error: { message: 'boom' } }
      const end = Math.min(to + 1, from + (opts.cap ?? Infinity), total)
      return { data: Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i), error: null }
    },
  })
  return { build, calls }
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
})
