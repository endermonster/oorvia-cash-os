import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Op = { op: 'upsert' | 'delete' | 'update'; table: string; rows?: unknown; patch?: unknown; filters?: Record<string, unknown> }
const h = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  ops: [] as unknown[],
  products: [] as unknown[],
  moved: 0,
  /** Upserts to this table fail (once each time it is set). */
  failUpsert: null as string | null,
}))

vi.mock('../supabase', () => ({
  supabase: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'lte', 'gte', 'in', 'order', 'not']) q[m] = () => q
      q.range = async (from: number, to: number) => ({ data: (h.tables[table] ?? []).slice(from, to + 1), error: null, status: 200 })
      q.upsert = async (rows: unknown) => {
        if (h.failUpsert === table) { h.failUpsert = null; return { error: { message: 'connection reset' }, status: 503 } }
        h.ops.push({ op: 'upsert', table, rows })
        return { error: null, status: 200 }
      }
      q.delete = () => {
        const filters: Record<string, unknown> = {}
        const d: Record<string, unknown> = {}
        d.eq = (c: string, v: unknown) => { filters[c] = v; return d }
        d.then = (resolve: (v: unknown) => void) => { h.ops.push({ op: 'delete', table, filters }); resolve({ error: null, status: 200 }) }
        return d
      }
      q.update = (patch: unknown) => {
        const filters: Record<string, unknown> = {}
        const u: Record<string, unknown> = {}
        u.eq = (c: string, v: unknown) => { filters[c] = v; return u }
        u.select = async () => { h.ops.push({ op: 'update', table, patch, filters }); return { data: Array.from({ length: h.moved }, (_, i) => ({ campaign_id: String(i) })), error: null, status: 200 } }
        u.then = (resolve: (v: unknown) => void) => { h.ops.push({ op: 'update', table, patch, filters }); resolve({ error: null, status: 200 }) }
        return u
      }
      return q
    },
  }),
}))
vi.mock('../sync-run', () => ({ withRun: async (_s: string, _id: string, fn: () => Promise<object>) => fn() }))
vi.mock('./client', () => ({
  gql: async () => ({ products: { nodes: h.products, pageInfo: { hasNextPage: false, endCursor: null } } }),
}))

const { syncProducts } = await import('./sync')

const product = (id: number, handle: string, sku: string) => ({
  id: `gid://shopify/Product/${id}`, title: `Product ${id}`, handle, status: 'ACTIVE',
  variants: {
    nodes: [{ id: `gid://shopify/ProductVariant/${id}`, sku, price: '100.00', inventoryItem: { unitCost: null, measurement: null } }],
    pageInfo: { hasNextPage: false },
  },
})
const stored = (id: number, handle: string, sku: string) => ({ sku, handle, packed_weight_grams: 500, shopify_product_id: id })
const kinds = () => (h.ops as Op[]).map((o) => `${o.op}:${o.table}`)
const ops = (kind: string) => (h.ops as Op[]).filter((o) => `${o.op}:${o.table}` === kind)

beforeEach(() => {
  h.tables = { cc_products: [], cc_cogs_history: [], cc_handle_aliases: [] }
  h.ops = []
  h.products = []
  h.moved = 0
  h.failUpsert = null
})

describe('syncProducts: renames', () => {
  it('writes the alias and moves the campaigns BEFORE the product upsert, and reports it as info', async () => {
    h.tables.cc_products = [stored(11, 'old-handle', 'SK-1')]
    h.products = [product(11, 'new-handle', 'SK-1')]
    h.moved = 3
    const r = await syncProducts('oorvia')
    expect(kinds()).toEqual(['delete:cc_handle_aliases', 'upsert:cc_handle_aliases', 'update:cc_campaigns', 'upsert:cc_products'])
    expect(ops('upsert:cc_handle_aliases')[0].rows).toEqual({ store_id: 'oorvia', old_handle: 'old-handle', handle: 'new-handle' })
    expect(ops('update:cc_campaigns')[0]).toMatchObject({ patch: { landing_handle: 'new-handle' }, filters: { store_id: 'oorvia', landing_handle: 'old-handle' } })
    expect((ops('upsert:cc_products')[0].rows as { handle: string }[])[0].handle).toBe('new-handle') // the SKU upsert still updates the handle
    expect(r.info).toEqual(['renamed old-handle -> new-handle: aliased, 3 campaigns moved'])
    expect(r.skipped).toEqual([]) // information, not a problem
  })

  it('a dry run reports the rename and writes nothing', async () => {
    h.tables.cc_products = [stored(11, 'old-handle', 'SK-1')]
    h.products = [product(11, 'new-handle', 'SK-1')]
    const r = await syncProducts('oorvia', { dryRun: true })
    expect(h.ops).toEqual([])
    expect(r.info[0]).toMatch(/renamed old-handle -> new-handle \(would alias/)
  })

  it('does nothing about a product whose handle is unchanged', async () => {
    h.tables.cc_products = [stored(11, 'same', 'SK-1')]
    h.products = [product(11, 'same', 'SK-1')]
    const r = await syncProducts('oorvia')
    expect(kinds()).toEqual(['upsert:cc_products'])
    expect(r.info).toEqual([])
  })

  it('handles a rename back (B -> A after A -> B): the old alias is dropped and the new one written', async () => {
    h.tables.cc_products = [stored(11, 'b', 'SK-1')]
    h.tables.cc_handle_aliases = [{ old_handle: 'a', handle: 'b' }]
    h.products = [product(11, 'a', 'SK-1')]
    await syncProducts('oorvia')
    const deleted = ops('delete:cc_handle_aliases').map((o) => o.filters!.old_handle)
    expect(deleted).toContain('a')
    expect(ops('upsert:cc_handle_aliases')[0].rows).toEqual({ store_id: 'oorvia', old_handle: 'b', handle: 'a' })
    expect(kinds().indexOf('upsert:cc_products')).toBe(kinds().length - 1)
  })

  it('drops a rename whose old handle is a live product now (a reused handle)', async () => {
    h.tables.cc_products = [stored(11, 'old-handle', 'SK-1')]
    h.products = [product(11, 'new-handle', 'SK-1'), product(12, 'old-handle', 'SK-2')]
    const r = await syncProducts('oorvia')
    expect(ops('upsert:cc_handle_aliases')).toEqual([])
    expect(ops('update:cc_campaigns')).toEqual([])
    expect(r.info).toEqual([])
  })

  it('deletes a stored alias whose old handle is a live product again, with an info line', async () => {
    h.tables.cc_products = [stored(11, 'back', 'SK-1')]
    h.tables.cc_handle_aliases = [{ old_handle: 'back', handle: 'elsewhere' }]
    h.products = [product(11, 'back', 'SK-1')]
    const r = await syncProducts('oorvia')
    expect(ops('delete:cc_handle_aliases')[0].filters).toEqual({ store_id: 'oorvia', old_handle: 'back' })
    expect(r.info).toEqual(['alias back -> elsewhere removed: back is a live product again'])
    expect(kinds().indexOf('delete:cc_handle_aliases')).toBeLessThan(kinds().indexOf('upsert:cc_products'))
  })

  it('a dry run says it would remove the stale alias, and deletes nothing', async () => {
    h.tables.cc_products = [stored(11, 'back', 'SK-1')]
    h.tables.cc_handle_aliases = [{ old_handle: 'back', handle: 'elsewhere' }]
    h.products = [product(11, 'back', 'SK-1')]
    const r = await syncProducts('oorvia', { dryRun: true })
    expect(h.ops).toEqual([])
    expect(r.info[0]).toMatch(/would be removed/)
  })

  it('when the alias write fails, leaves the product on its old handle, so the next run redoes the rename', async () => {
    h.tables.cc_products = [stored(11, 'old-handle', 'SK-1')]
    h.products = [product(11, 'new-handle', 'SK-1')]
    h.failUpsert = 'cc_handle_aliases'
    await expect(syncProducts('oorvia')).rejects.toThrow(/connection reset/)
    expect(ops('upsert:cc_products')).toEqual([])
    expect(ops('update:cc_campaigns')).toEqual([])

    h.ops = []
    const r = await syncProducts('oorvia') // cc_products still says old-handle
    expect(kinds()).toEqual(['delete:cc_handle_aliases', 'upsert:cc_handle_aliases', 'update:cc_campaigns', 'upsert:cc_products'])
    expect(r.info[0]).toMatch(/^renamed old-handle -> new-handle: aliased/)
  })
})

describe('syncProducts: SKU changes', () => {
  it('skips a product whose SKU and handle both changed, instead of inserting a second row for it', async () => {
    h.tables.cc_products = [stored(11, 'old-handle', 'SK-1')]
    h.products = [product(11, 'new-handle', 'SK-2')]
    const r = await syncProducts('oorvia')
    expect(ops('upsert:cc_products')).toEqual([])
    expect(ops('upsert:cc_handle_aliases')).toEqual([])
    expect(r.info).toEqual([])
    expect(r.skipped.join()).toMatch(/set up as SKU SK-1 but Shopify now says SK-2; fix by hand/)
  })
})
