// Imports a Shopify admin orders export (CSV) into cc_orders / cc_order_lines: history the API cannot reach.
// Run: NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/shopify-csv-import.ts \
//        --store oorvia --file <export.csv> --since YYYY-MM-DD [--dry-run]
// Rows are written with shopify_updated_at = 2000-01-01, so an order the live sync already stored is left alone.
// Writes no cc_sync_runs row: a history import is not a fresh sync and must not mark Shopify as up to date.
// Cross-checks payment and total against the old Cash OS `orders` table where it has the order (read only).
// --dry-run reads only and prints the plan. A real run writes nothing while any product line is unresolved.
// Exit 1 when anything is reported, 2 on bad usage.
import { readFileSync } from 'node:fs'
import { csvRecords } from '../src/lib/csv'
import { selectAll } from '../src/lib/paged'
import { CSV_UPDATED_AT, mapShopifyCsv, type CsvProduct } from '../src/lib/shopify/csv-orders'
import { supabase } from '../src/lib/supabase'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const OLD_PAYMENT: Record<string, string> = { cash_on_delivery: 'cod', prepaid_cashfree: 'prepaid', prepaid_razorpay: 'prepaid' }

async function main() {
  const store = arg('store'), file = arg('file'), since = arg('since')
  const dryRun = process.argv.includes('--dry-run')
  if (!store || !file || !since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    console.error('Usage: --store <id> --file <export.csv> --since YYYY-MM-DD [--dry-run]')
    process.exit(2)
  }
  const sb = supabase()
  const { data: storeRow, error: se } = await sb.from('cc_stores').select('order_prefix').eq('id', store).single()
  if (se || !storeRow) throw new Error(`store ${store}: ${se?.message ?? 'not found'}`)

  const products = await selectAll<CsvProduct>(() => sb.from('cc_products').select('sku, name, shopify_product_id').eq('store_id', store).order('sku'))
  const { orders, report } = mapShopifyCsv(csvRecords(readFileSync(file, 'utf8')), { storeId: store, prefix: storeRow.order_prefix, since, products })

  const stored = new Map((await selectAll<{ order_name: string; shopify_updated_at: string }>(
    () => sb.from('cc_orders').select('order_name, shopify_updated_at').eq('store_id', store).order('order_name'),
  )).map((r) => [r.order_name, Date.parse(r.shopify_updated_at)]))
  const old = new Map((await selectAll<{ shopify_order_name: string; payment_type: string; order_value: number | string }>(
    () => sb.from('orders').select('shopify_order_name, payment_type, order_value').order('shopify_order_name'),
  )).map((r) => [r.shopify_order_name, r]))

  const reported: string[] = []
  const payment: Record<string, number> = {}
  let wouldInsert = 0, wouldUpdate = 0, keepNewer = 0, cancelled = 0, checked = 0
  for (const { order: o } of orders) {
    payment[o.payment] = (payment[o.payment] ?? 0) + 1
    if (o.cancelled_at) cancelled++
    const prev = stored.get(o.order_name)
    if (prev === undefined) wouldInsert++
    else if (prev <= Date.parse(CSV_UPDATED_AT)) wouldUpdate++
    else keepNewer++
    const was = old.get(o.order_name)
    if (was) {
      checked++
      const oldPay = OLD_PAYMENT[was.payment_type]
      if (oldPay && oldPay !== o.payment) console.log(`  payment differs from old table: ${o.order_name} old ${oldPay}, Shopify ${o.payment}`)
      if (Math.abs(Math.round(Number(was.order_value) * 100) - o.total_paise) > 50) reported.push(`total differs from old table: ${o.order_name} old ${was.order_value}, Shopify ${o.total_paise / 100}`)
    }
  }
  const inFile = new Set(orders.map((x) => x.order.order_name))
  const missing = [...old.keys()].filter((n) => n.startsWith(storeRow.order_prefix) && !inFile.has(n))
  if (missing.length) reported.push(`${missing.length} old-table order(s) not in the export from ${since}: ${missing.slice(0, 10).join(', ')}`)

  const dates = orders.map((x) => x.order.placed_at.slice(0, 10)).sort()
  console.log(`\n== ${store}${dryRun ? ' (dry run: nothing is written)' : ''}`)
  console.log(`orders ${orders.length} (${dates[0]} → ${dates.at(-1)}), skipped ${report.skipped}, cancelled ${cancelled}`)
  console.log(`payment ${JSON.stringify(payment)}`)
  console.log(`would insert ${wouldInsert}, update ${wouldUpdate}, leave ${keepNewer} (live sync has a newer copy)`)
  console.log(`cross-checked ${checked} against the old orders table`)
  for (const m of report.matchedByName) console.log(`  sku by name: ${m.order} "${m.name}" -> ${m.sku}`)
  for (const o of orders.filter((x) => x.order.payment === 'unknown')) console.log(`  payment unknown: ${o.order.order_name}${o.order.cancelled_at ? ' (cancelled)' : ''}`)
  for (const u of report.unresolved) reported.push(`no SKU: ${u.order} "${u.name}"`)
  for (const [sku, n] of Object.entries(report.unknownSkus)) reported.push(`SKU not in cc_products: ${sku} x${n}`)

  // A product line with no SKU and no product id would be stored like an add-on: no cost and no "costs missing"
  // warning, so profit would read high. Refuse the whole write until every such line is resolved.
  if (!dryRun && report.unresolved.length) {
    console.error(`
Nothing written: ${report.unresolved.length} product line(s) have no SKU and match no product by name. Set the SKU in Shopify or add the product, then rerun.`)
    for (const u of report.unresolved) console.error(`  - ${u.order} "${u.name}"`)
    process.exit(1)
  }
  if (!dryRun) {
    let written = 0, stale = 0
    for (const { order, lines } of orders) {
      const { data, error } = await sb.rpc('cc_upsert_order', { p_order: order, p_lines: lines })
      if (error) throw new Error(`cc_upsert_order ${order.order_name}: ${error.message}`)
      if (data === true) written++
      else stale++
    }
    console.log(`written ${written}, left alone ${stale}`)
  }

  if (reported.length) {
    console.log(`\n${reported.length} item(s) reported:`)
    for (const s of reported) console.log(`  - ${s}`)
    process.exit(1)
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
