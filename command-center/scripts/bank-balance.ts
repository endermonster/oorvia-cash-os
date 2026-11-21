// Records the bank balance by hand. The same entry can be made on /settings.
// Run: NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/bank-balance.ts \
//        [--amount <rupees>] [--date YYYY-MM-DD] [--note <text>]
// With no --amount, prints the latest entry and changes nothing. --date defaults to today (IST).
// Each entry is a new row; the dashboard uses the latest by date. Exit 2 on bad usage.
import { istNow } from '../src/lib/dates'
import { supabase } from '../src/lib/supabase'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

async function main() {
  const sb = supabase()
  const raw = arg('amount')
  if (raw !== undefined) {
    const t = raw.replace(/[,₹\s]/g, '')
    if (!/^-?\d+(\.\d{1,2})?$/.test(t)) { console.error(`--amount must be rupees, e.g. 58050 or 58050.75 (got ${JSON.stringify(raw)})`); process.exit(2) }
    const date = arg('date') ?? istNow(new Date()).today
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error('--date must be YYYY-MM-DD'); process.exit(2) }
    const amountPaise = Math.round(Number(t) * 100)
    const { error } = await sb.from('cc_bank_balances').insert({ amount_paise: amountPaise, entered_on: date, note: arg('note') ?? null })
    if (error) throw new Error(`cc_bank_balances: ${error.message}`)
    console.log(`Recorded bank balance ${inr(amountPaise)} on ${date}.`)
  }
  const { data, error } = await sb.from('cc_bank_balances').select('amount_paise, entered_on, note')
    .order('entered_on', { ascending: false }).order('created_at', { ascending: false }).limit(1)
  if (error) throw new Error(`cc_bank_balances: ${error.message}`)
  const last = data?.[0]
  console.log(last ? `Latest: ${inr(Number(last.amount_paise))} on ${last.entered_on}${last.note ? ` (${last.note})` : ''}` : 'No bank balance entered yet.')
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
