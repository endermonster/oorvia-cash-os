// PostgREST caps unbounded selects (1000 rows by default). A truncated read does not
// error: it shows up as an understated figure. Every aggregate read goes through this.
// Ported from the old app's lib/paged.js.

import { DbError } from './db-error'

const PAGE_SIZE = 1000

// Row types come from the caller: the client is untyped (no generated DB types), so rows are `unknown` here.
type PageResult = PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null; status?: number; count?: number | null }>
/** `setHeader` is the real PostgREST builder's; without it (test fakes) the read pages until an empty page. */
type Query = { range(from: number, to: number): PageResult; setHeader?(name: string, value: string): unknown }

/**
 * Reads every row a query matches, paging with `.range()`. Errors are thrown, never swallowed.
 * `buildQuery` must be a factory: PostgREST builders are single-use. The query should
 * carry a deterministic `.order()` so pages do not overlap.
 *
 * Pages are read one after another, never in parallel: a row inserted mid-read then shifts every later page the
 * same way (at worst a row is read twice), where parallel pages could each see a different table and skip one.
 * The first page also asks for the total (`Prefer: count=exact`), which saves the closing empty-page read: the read
 * ends on a short page once it has the counted rows. A full page, or no count, still reads on to an empty page.
 */
export async function selectAll<T>(buildQuery: () => Query, { pageSize = PAGE_SIZE }: { pageSize?: number } = {}): Promise<T[]> {
  const rows: unknown[] = []
  let total: number | null = null
  for (;;) {
    const from = rows.length // advance by rows actually received: a server cap below pageSize must not skip rows
    const q = buildQuery()
    if (from === 0) q.setHeader?.('Prefer', 'count=exact')
    const { data, error, status, count } = await q.range(from, from + pageSize - 1)
    if (error) throw new DbError(error.message, error.code || undefined, status) // keeps code and status: a webhook retries only transient failures
    if (from === 0 && typeof count === 'number') total = count
    // An empty page always ends the read: a server that caps below `pageSize` returns short pages mid-table.
    if (!data || data.length === 0) break
    rows.push(...data)
    // A short page is the end of the table once the counted rows are in. A full one may have rows after it.
    if (total !== null && data.length < pageSize && rows.length >= total) break
  }
  return rows as T[]
}
