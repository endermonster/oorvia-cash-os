/**
 * Shopify admin orders export (Orders → Export → CSV) to cc_orders / cc_order_lines rows, for history the
 * API cannot reach (it sees 60 days). Pure. Each order goes through the live sync's `mapOrder`, so both
 * paths store the same shape; only payment differs (see `csvPayment`).
 *
 * The export has one row per line item; order fields are filled on an order's first row only.
 */
import type { OrderPayment } from '../types'
import { classifyGateway, mapOrder, type GqlLine, type GqlOrder, type LineRowOut, type OrderRowOut } from './map'

export type CsvOrderRow = Omit<OrderRowOut, 'payment'> & { payment: OrderPayment }
export type CsvOrder = { order: CsvOrderRow; lines: LineRowOut[] }
export type CsvProduct = { sku: string; name: string; shopify_product_id: number | null }

/**
 * Older than any real Shopify `updatedAt`, so an order already stored by the live sync is never overwritten,
 * and a later webhook or backfill always replaces a CSV row.
 */
export const CSV_UPDATED_AT = '2000-01-01T00:00:00Z'

/**
 * The export's Payment Method. Blank (draft or hand-marked orders) or a gateway that is neither COD nor a
 * known prepaid one is `unknown`: never guessed.
 */
export function csvPayment(method: string): OrderPayment {
  const m = method.trim()
  if (!m) return 'unknown'
  const c = classifyGateway(m)
  return c === 'unknown' ? 'unknown' : c
}

/** "2026-03-21 10:05:09 +0530" → "2026-03-21T10:05:09+05:30". Null for blank. */
export function csvTime(v: string): string | null {
  const t = v.trim()
  if (!t) return null
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/.exec(t)
  if (!m) throw new Error(`unrecognised Shopify export time: ${JSON.stringify(t)}`)
  return `${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}`
}

/** Note Attributes: one "key: value" per line. */
export function noteAttributes(v: string): { key: string; value: string }[] {
  return v.split(/\r?\n/).flatMap((line) => {
    const i = line.indexOf(':')
    return i > 0 ? [{ key: line.slice(0, i).trim(), value: line.slice(i + 1).trim() }] : []
  })
}

/** Letters and digits only: the export mangles "™" into U+FFFD, so names are compared without symbols. */
const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export type CsvReport = {
  /** Orders outside the store's prefix or before `since`. */
  skipped: number
  /** Blank-SKU lines given a SKU by their product name. */
  matchedByName: { order: string; name: string; sku: string }[]
  /** Product lines left with no SKU (cost unknown). */
  unresolved: { order: string; name: string }[]
  /** SKUs on lines that no product in the store has (their cost shows as missing), with line counts. */
  unknownSkus: Record<string, number>
}

/**
 * Orders of one store (`prefix`, e.g. "#OV") placed on or after `since` (YYYY-MM-DD, IST).
 * A blank-SKU line takes the SKU of the one product with the same name; if none or several match, it is reported.
 */
export function mapShopifyCsv(
  records: Record<string, string>[],
  opts: { storeId: string; prefix: string; since: string; products: CsvProduct[] },
): { orders: CsvOrder[]; report: CsvReport } {
  const byName = new Map<string, Record<string, string>[]>()
  for (const r of records) {
    const name = r['Name']?.trim()
    if (!name) throw new Error('Shopify export row with no Name')
    byName.set(name, [...(byName.get(name) ?? []), r])
  }

  const productIdToSku = new Map<string, string>()
  const byProductName = new Map<string, CsvProduct[]>()
  for (const p of opts.products) {
    if (p.shopify_product_id !== null) productIdToSku.set(String(p.shopify_product_id), p.sku)
    const k = nameKey(p.name)
    byProductName.set(k, [...(byProductName.get(k) ?? []), p])
  }

  const report: CsvReport = { skipped: 0, matchedByName: [], unresolved: [], unknownSkus: {} }
  const known = new Set(opts.products.map((p) => p.sku))
  const orders: CsvOrder[] = []
  for (const [name, rows] of byName) {
    const head = rows[0]
    const placedAt = csvTime(head['Created at'])
    if (!placedAt) throw new Error(`${name}: no Created at`)
    // The time carries its offset (+05:30 for Shopify India), so the first 10 characters are the IST date.
    if (!name.startsWith(opts.prefix) || placedAt.slice(0, 10) < opts.since) { report.skipped++; continue }

    const nameMatched = new Map<number, string>()
    const nodes: GqlLine[] = rows.map((r, i) => {
      const sku = r['Lineitem sku'].trim() || null
      let product: GqlLine['product'] = null
      if (!sku) {
        const hits = byProductName.get(nameKey(r['Lineitem name'])) ?? []
        if (hits.length === 1 && hits[0].shopify_product_id !== null) {
          product = { id: `gid://shopify/Product/${hits[0].shopify_product_id}` }
          nameMatched.set(i, hits[0].sku)
        }
      }
      return {
        id: `${name}#${i + 1}`,
        sku,
        // A restocked line is no longer part of the order: the API reports it as currentQuantity 0.
        currentQuantity: r['Lineitem fulfillment status'].trim() === 'restocked' ? 0 : Number(r['Lineitem quantity']),
        originalUnitPriceSet: { shopMoney: { amount: r['Lineitem price'] } },
        product,
        variant: null,
      }
    })

    const zip = head['Shipping Zip'].trim().replace(/^'/, '')
    const gql: GqlOrder = {
      id: `gid://shopify/Order/${head['Id'].trim()}`,
      name,
      createdAt: placedAt,
      updatedAt: CSV_UPDATED_AT,
      cancelledAt: csvTime(head['Cancelled at']),
      test: false,
      tags: head['Tags'].split(',').map((t) => t.trim()).filter(Boolean),
      currentTotalPriceSet: { shopMoney: { amount: head['Total'] } },
      paymentGatewayNames: head['Payment Method'].trim() ? [head['Payment Method'].trim()] : [],
      shippingAddress: { city: head['Shipping City'], province: head['Shipping Province Name'] || head['Shipping Province'], zip },
      customAttributes: noteAttributes(head['Note Attributes']),
      lineItems: { nodes },
    }
    const mapped = mapOrder(opts.storeId, gql, productIdToSku)
    if (!Number.isSafeInteger(mapped.order.shopify_order_id) || mapped.order.shopify_order_id <= 0) throw new Error(`${name}: bad Id ${JSON.stringify(head['Id'])}`)
    if (!Number.isFinite(mapped.order.total_paise)) throw new Error(`${name}: bad Total ${JSON.stringify(head['Total'])}`)

    const live = rows.filter((r) => r['Lineitem fulfillment status'].trim() !== 'restocked')
    for (const [i, sku] of nameMatched) if (live.includes(rows[i])) report.matchedByName.push({ order: name, name: rows[i]['Lineitem name'], sku })
    mapped.lines.forEach((l, i) => {
      if (l.sku === null) report.unresolved.push({ order: name, name: live[i]['Lineitem name'] })
      else if (!known.has(l.sku)) report.unknownSkus[l.sku] = (report.unknownSkus[l.sku] ?? 0) + 1
    })
    orders.push({ order: { ...mapped.order, payment: csvPayment(head['Payment Method']) }, lines: mapped.lines })
  }
  return { orders, report }
}
