// Compares the new monthly P&L for Oorvia with old Cash OS's Phase 0 answer keys (../../phase0/pnl-YYYY-MM.json).
// Read-only. Prints each line side by side in rupees; exit code 1 when a line differs by more than ₹1.
// Run: NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/pnl-reconcile.ts [--from 2026-03 --to 2026-08]
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadPnl } from '../src/lib/pnl-load'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

type Key = {
  revenue_gross: number; revenue_net: number; variable_costs: number; cogs: number; fixed_costs_prorated: number; marketing_net: number; net_profit: number
  orders: { delivered: number; rto: number; cancelled: number }
  cost_by_head: Record<string, number>
}

const CHECKOUT = 'Checkout Service Fee'
const GATEWAY = 'Payment Gateway Fee'

async function main() {
  const from = arg('from', '2026-03')
  const to = arg('to', '2026-08')
  const r = await loadPnl(from, to)
  let off = 0
  const row = (label: string, oldV: number, newV: number) => {
    const d = newV - oldV
    if (Math.abs(d) > 1) off++
    console.log(`  ${label.padEnd(30)} ${oldV.toFixed(2).padStart(12)} ${newV.toFixed(2).padStart(12)} ${Math.abs(d) > 1 ? `  Δ ${d.toFixed(2)}` : ''}`)
  }
  for (const m of r.months) {
    const k: Key = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'phase0', `pnl-${m.month}.json`), 'utf8'))
    // Shared costs (vFulfill bills, storage) only existed for Oorvia then, so VXP is the like-for-like figure.
    const l = m.vxp
    const rs = (p: number) => p / 100
    console.log(`\n== ${m.month}                          old (Cash OS)   new`)
    row('orders delivered', k.orders.delivered, l.orders.delivered)
    row('orders RTO', k.orders.rto, l.orders.rto)
    row('orders cancelled', k.orders.cancelled, l.orders.cancelled)
    row('revenue gross', k.revenue_gross, rs(l.revenueGross))
    row('revenue net', k.revenue_net, rs(l.revenueNet))
    row('COGS', k.cogs, rs(l.cogs))
    const oldVf = Object.entries(k.cost_by_head).filter(([h]) => h !== CHECKOUT && h !== GATEWAY)
    const heads = new Set([...oldVf.map(([h]) => h), ...Object.keys(l.vfByHead)])
    for (const h of [...heads].sort()) row(`  vF ${h}`, k.cost_by_head[h] ?? 0, rs(l.vfByHead[h] ?? 0))
    row('checkout (Fastrr)', k.cost_by_head[CHECKOUT] ?? 0, rs(l.checkoutFees))
    row('gateway', k.cost_by_head[GATEWAY] ?? 0, rs(l.gatewayFees))
    row('ad spend', k.marketing_net, rs(l.adSpend))
    row('fixed costs', k.fixed_costs_prorated, rs(l.fixedCosts))
    row('NET PROFIT', k.net_profit, rs(l.netProfit))
  }
  if (r.warnings.length) console.log(`\nwarnings:\n- ${r.warnings.join('\n- ')}`)
  console.log(`\n${off} line(s) differ by more than ₹1`)
  process.exit(off > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(2) })
