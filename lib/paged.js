// PostgREST caps unbounded selects (1000 rows by default), and it serialises
// .in() lists into the query string, so long lists eventually blow the URL
// limit. Every aggregate read must go through these helpers — a truncated
// select here shows up as an understated cost figure, not as an error.

const PAGE_SIZE  = 1000
const CHUNK_SIZE = 400

/**
 * Reads every row a query matches, paging until exhausted.
 * `buildQuery` must be a factory — PostgREST builders are single-use.
 *
 *   await selectAll(() => supabase.from('order_costs').select('*').eq('source', 'vfulfill'))
 */
export async function selectAll(buildQuery, { pageSize = PAGE_SIZE } = {}) {
  const rows = []
  let from = 0

  for (;;) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break

    rows.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }

  return rows
}

/**
 * Same, for `.in(column, values)` reads: splits `values` into URL-safe chunks
 * and pages within each chunk.
 *
 *   await selectAllIn(
 *     (chunk) => supabase.from('order_costs').select('*').in('shopify_order_name', chunk),
 *     orderNames
 *   )
 */
export async function selectAllIn(buildQuery, values, { chunkSize = CHUNK_SIZE, pageSize = PAGE_SIZE } = {}) {
  const unique = [...new Set(values)].filter((v) => v !== null && v !== undefined)
  if (unique.length === 0) return []

  const rows = []
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize)
    rows.push(...(await selectAll(() => buildQuery(chunk), { pageSize })))
  }
  return rows
}
