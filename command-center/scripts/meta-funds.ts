// Runs the ad account funds check by hand. Prints each account's level and push, never credentials or the ntfy topic.
// Run: NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/meta-funds.ts [--dry-run]
// --dry-run reads Meta and the stored alert levels but writes nothing and pushes nothing.
import { checkFunds } from '../src/lib/meta/funds'

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const r = await checkFunds({ dryRun })
  for (const a of r.accounts) console.log(JSON.stringify(a))
  console.log(`ok: ${r.ok}${dryRun ? ' (dry run: nothing written or pushed)' : ''}`)
  if (!r.ok) process.exit(1)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
