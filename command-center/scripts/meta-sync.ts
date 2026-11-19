// Runs the Meta ad spend sync by hand. Prints counts and reported items, never credentials.
// Run: NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/meta-sync.ts \
//        --store kaiven|oorvia|selnova|all [--since YYYY-MM-DD] [--dry-run]
// Default window: the last 7 days plus today (Meta revises recent days); --since backfills from a date.
// --dry-run reads Meta and the database but writes nothing (no cc_sync_runs row either) and prints the plan.
// Exit code is 1 when anything was reported or an account could not be synced (so a cron notices), 2 on bad usage.
import { metaStoreIds } from '../src/lib/meta/accounts'
import { syncMeta } from '../src/lib/meta/sync'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)
const inr = (paise: number) => (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function main() {
  const store = arg('store')
  if (!store) {
    console.error('Usage: --store kaiven|oorvia|selnova|all [--since YYYY-MM-DD] [--dry-run]')
    process.exit(2)
  }
  const since = arg('since')
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('--since must be YYYY-MM-DD')
  const dryRun = flag('dry-run')
  const ids = store === 'all' ? metaStoreIds() : [store]
  const reported: string[] = []

  for (const id of ids) {
    console.log(`\n== ${id}${dryRun ? ' (dry run: nothing is written)' : ''}`)
    const { plan, skipped, warnings, accounts, ...counts } = await syncMeta(id, { since, dryRun })
    console.log('meta', JSON.stringify({ ...counts, spend_inr: inr(counts.spend_paise) }))
    for (const a of accounts) {
      console.log(`  account ${a.name} (${a.account}): ${a.status}, ${a.campaigns} campaigns, ${a.day_rows} day rows, ${a.hour_rows} hour rows, spend INR ${inr(a.spend_paise)}`)
    }
    if (plan) {
      for (const c of plan.campaigns) console.log(`  campaign ${c.id} ${JSON.stringify(c.name)} -> ${c.handle ?? '(no handle)'} [${c.status ?? 'no status'}] spend INR ${inr(c.spend_paise)}`)
    }
    for (const w of warnings) console.log(`  WARNING: ${w}`)
    for (const s of skipped) { console.log(`  REPORTED: ${s}`); reported.push(`${id}: ${s}`) }
  }

  if (reported.length > 0) {
    console.log(`\n${reported.length} item(s) reported:`)
    for (const s of reported) console.log(`  - ${s}`)
    process.exit(1)
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
