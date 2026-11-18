// Runs the Shopify sync by hand. Prints counts and reported items, never credentials.
// Run: NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/shopify-sync.ts \
//        --store kaiven|oorvia|selnova|all [--products] [--orders] [--since YYYY-MM-DD] [--dry-run]
// Products run before orders, so blank variant SKUs resolve through the product id.
// --dry-run reads Shopify and the database but writes nothing (no cc_sync_runs row either) and prints the plan.
// Exit code is 1 when anything was skipped or reported (so a cron notices), 2 on bad usage.
import { allStoreIds } from '../src/lib/shopify/client'
import { backfillOrders, syncProducts } from '../src/lib/shopify/sync'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

async function main() {
  const store = arg('store')
  if (!store || !(flag('products') || flag('orders'))) {
    console.error('Usage: --store kaiven|oorvia|selnova|all [--products] [--orders] [--since YYYY-MM-DD] [--dry-run]')
    process.exit(2)
  }
  const since = arg('since')
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('--since must be YYYY-MM-DD')
  const dryRun = flag('dry-run')
  const ids = store === 'all' ? await allStoreIds() : [store]
  const reported: string[] = []

  for (const id of ids) {
    console.log(`\n== ${id}${dryRun ? ' (dry run: nothing is written)' : ''}`)
    if (flag('products')) {
      const r = await syncProducts(id, { dryRun })
      const { plan, skipped, ...counts } = r
      console.log('products', JSON.stringify(counts))
      if (plan) {
        for (const a of plan.actions) console.log(`  ${a.action.padEnd(6)} ${a.handle}${a.sku ? ` [${a.sku}]` : ''} matched by ${a.matched}${a.reason ? ` - ${a.reason}` : ''}`)
        for (const c of plan.costs) console.log(`  cost   ${c.sku} -> ${(c.cogs_paise / 100).toFixed(2)} effective ${c.effective_from}`)
      }
      for (const s of skipped) { console.log(`  REPORTED: ${s}`); reported.push(`${id}: ${s}`) }
    }
    if (flag('orders')) {
      const r = await backfillOrders(id, { since, dryRun })
      const { plan, ...counts } = r
      console.log('orders', JSON.stringify(counts))
      if (plan) {
        console.log(`  would insert ${plan.would_insert}, update ${plan.would_update}; payment cod ${plan.payment.cod}, prepaid ${plan.payment.prepaid}`)
        for (const g of plan.gateways) console.log(`  gateway ${JSON.stringify(g.name)} x${g.count} -> ${g.class}`)
        for (const u of plan.unresolved) console.log(`  unresolved product line: ${u.order} product ${u.product_id}`)
      }
      for (const [name, n] of Object.entries(r.unknownGateways)) reported.push(`${id}: unknown payment gateway ${JSON.stringify(name)} x${n}`)
      if (r.unresolved_lines > 0) reported.push(`${id}: ${r.unresolved_lines} product line(s) with no resolvable SKU`)
    }
  }

  if (reported.length > 0) {
    console.log(`\n${reported.length} item(s) reported:`)
    for (const s of reported) console.log(`  - ${s}`)
    process.exit(1)
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
