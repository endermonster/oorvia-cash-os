// Smoke test for the Supabase read. Prints row counts per Data field; never prints keys.
// Run: NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/check-load.ts
// (`server-only` throws outside the react-server condition, so the option is required.)
import { loadData } from '../src/lib/load'
import { createMetrics } from '../src/lib/metrics'

async function main() {
  const d = await loadData()
  const counts: Record<string, number> = {}
  for (const [k, v] of Object.entries(d)) if (Array.isArray(v)) counts[k] = v.length
  console.log('source', d.source, '| today', d.today, '| nowHour', d.nowHour)
  console.log(counts)
  console.log('stores:', d.stores.map((s) => s.name).join(', '))
  console.log('cash/gst/ownerShareMonth:', d.cash, d.gst, d.ownerShareMonth)
  console.log('sync:', d.sync)

  const m = createMetrics(d)
  for (const id of ['today', '7d', '30d', 'month'] as const) {
    const p = m.resolvePeriod(id)
    const pf = m.portfolio(p)
    console.log(id, 'orders', pf.total.orders, 'revenue', Math.round(pf.total.revenue), 'spend', Math.round(pf.total.spend), 'series pts', m.series(d.stores.map((s) => s.id), p).length)
  }
  console.log('calls:', m.calls(m.resolvePeriod('7d')).map((c) => c.title))
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
