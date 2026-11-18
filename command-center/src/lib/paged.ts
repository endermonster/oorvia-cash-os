// PostgREST caps unbounded selects (1000 rows by default). A truncated read does not
// error: it shows up as an understated figure. Every aggregate read goes through this.
// Ported from the old app's lib/paged.js.

const PAGE_SIZE = 1000

// Row types come from the caller: the client is untyped (no generated DB types), so rows are `unknown` here.
type PageResult = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>

/**
 * Reads every row a query matches, paging with `.range()` until an empty page. Errors are thrown, never swallowed.
 * `buildQuery` must be a factory: PostgREST builders are single-use. The query should
 * carry a deterministic `.order()` so pages do not overlap.
 */
export async function selectAll<T>(
  buildQuery: () => { range(from: number, to: number): PageResult },
  { pageSize = PAGE_SIZE }: { pageSize?: number } = {},
): Promise<T[]> {
  const rows: unknown[] = []
  for (;;) {
    const from = rows.length // advance by rows actually received: a server cap below pageSize must not skip rows
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    // Stop only on an empty page: a server that caps below `pageSize` returns short pages mid-table.
    if (!data || data.length === 0) break
    rows.push(...data)
  }
  return rows as T[]
}
