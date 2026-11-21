// Imports vFulfill exports (every store at once: one vFulfill account). The same import runs from /settings.
// Run: NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/vf-import.ts \
//        [--shipments <export.csv>] [--transactions <export.csv>] [--dry-run]
// What it writes and checks: src/lib/vfulfill/import.ts.
// Exit 1 when anything is reported, 2 on bad usage.
import { readFileSync } from 'node:fs'
import { supabase } from '../src/lib/supabase'
import { importVfulfill } from '../src/lib/vfulfill/import'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const shipFile = arg('shipments'), txnFile = arg('transactions')
  const dryRun = process.argv.includes('--dry-run')
  if (!shipFile && !txnFile) { console.error('Usage: [--shipments <export.csv>] [--transactions <export.csv>] [--dry-run]'); process.exit(2) }
  const { lines, reported } = await importVfulfill(supabase(), {
    shipments: shipFile ? readFileSync(shipFile, 'utf8') : undefined,
    transactions: txnFile ? readFileSync(txnFile, 'utf8') : undefined,
  }, dryRun)
  for (const l of lines) console.log(l)

  if (reported.length) {
    console.log(`\n${reported.length} item(s) reported:`)
    for (const s of reported) console.log(`  - ${s}`)
    process.exit(1)
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
