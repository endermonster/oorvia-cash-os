// PostgREST caps unbounded selects (1000 rows by default). A truncated read does not
// error: it shows up as an understated figure. Every aggregate read goes through this.
// Ported from the old app's lib/paged.js.

import { DbError } from './db-error'

const PAGE_SIZE = 1000
/** Most pages of one read in flight at once: several reads run side by side and share PostgREST's connection pool. */
const MAX_PARALLEL = 4

// Row types come from the caller: the client is untyped (no generated DB types), so rows are `unknown` here.
type PageResult = PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null; status?: number; count?: number | null }>
/** `setHeader` is the real PostgREST builder's; without it (test fakes) the read pages one by one. */
type Query = { range(from: number, to: number): PageResult; setHeader?(name: string, value: string): unknown }

async function page(query: Query, from: number, to: number) {
  const { data, error, status, count } = await query.range(from, to)
  if (error) throw new DbError(error.message, error.code || undefined, status) // keeps code and status: a webhook retries only transient failures
  return { data: data ?? [], count: typeof count === 'number' ? count : null }
}

/**
 * Reads every row a query matches. Errors are thrown, never swallowed.
 * `buildQuery` must be a factory: PostgREST builders are single-use. The query should
 * carry a deterministic `.order()` so pages do not overlap.
 *
 * The first page also asks for the total (`Prefer: count=exact`): a read that ends on a short page is one round trip,
 * and the rest of a bigger one is fetched in parallel. It is done only when the pages add up to the total and the
 * last one came back short. Otherwise (rows changed mid-read, a full last page that rows may have been added after,
 * or no count) it pages on one by one until an empty page, as it always did.
 */
export async function selectAll<T>(buildQuery: () => Query, { pageSize = PAGE_SIZE }: { pageSize?: number } = {}): Promise<T[]> {
  const q = buildQuery()
  q.setHeader?.('Prefer', 'count=exact')
  const first = await page(q, 0, pageSize - 1)
  if (first.data.length === 0) return []

  let rows: unknown[] = first.data
  let lastShort = first.data.length < pageSize
  if (first.count !== null && first.data.length < first.count) {
    // The first page's length is what the server actually serves per page: pageSize, or a lower server cap.
    const step = first.data.length
    const starts: number[] = []
    for (let from = step; from < first.count; from += step) starts.push(from)
    const rest: unknown[][] = []
    for (let i = 0; i < starts.length; i += MAX_PARALLEL) {
      const batch = await Promise.all(starts.slice(i, i + MAX_PARALLEL).map((from) => page(buildQuery(), from, from + step - 1)))
      rest.push(...batch.map((p) => p.data))
    }
    const all = [...first.data, ...rest.flat()]
    // Every page but the last full, and the total matching: no gap and no overlap. Else page on from the first page.
    if (all.length === first.count && rest.every((p, i) => i === rest.length - 1 || p.length === step)) {
      rows = all
      lastShort = rest[rest.length - 1].length < step
    } else {
      lastShort = false
    }
  }
  if (first.count !== null && rows.length === first.count && lastShort) return rows as T[]

  for (;;) {
    const from = rows.length // advance by rows actually received: a server cap below pageSize must not skip rows
    const { data } = await page(buildQuery(), from, from + pageSize - 1)
    // Stop only on an empty page: a server that caps below `pageSize` returns short pages mid-table.
    if (data.length === 0) break
    rows = [...rows, ...data]
  }
  return rows as T[]
}
