import { fmtINR } from '@/lib/pnl'

const STEPS = [
  { key: 'revenue_net',           label: 'Revenue (net GST)',    type: 'positive' },
  { key: 'variable_costs',        label: '− Variable Costs',     type: 'negative' },
  { key: 'cogs',                  label: '− COGS',               type: 'negative' },
  { key: 'fixed_costs_prorated',  label: '− Fixed Costs',        type: 'negative' },
  { key: 'marketing_net',         label: '− Marketing',          type: 'negative' },
  { key: 'net_profit',            label: '= Net Profit',         type: 'result'   },
]

const barColors = {
  positive: 'bg-blue-600',
  negative: 'bg-red-800',
  result:   'bg-green-600',
}

export default function WaterfallCard({ pnl }) {
  if (!pnl) return null
  const maxVal = Math.max(pnl.revenue_net || 0, 1)

  return (
    <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-5">
      <h3 className="text-sm font-semibold text-zinc-100 mb-4">Revenue Waterfall</h3>
      <div className="space-y-1.5">
        {STEPS.map(({ key, label, type }) => {
          const val  = Number(pnl[key] || 0)
          const pct  = Math.max(0, Math.min(100, (Math.abs(val) / maxVal) * 100))
          const isResult = type === 'result'
          const barColor = isResult ? (val >= 0 ? 'bg-green-600' : 'bg-red-600') : barColors[type]
          const textColor = isResult
            ? val >= 0 ? 'text-green-400' : 'text-red-400'
            : type === 'negative' ? 'text-red-400' : 'text-zinc-200'

          return (
            <div key={key} className={`flex items-center gap-3 ${isResult ? 'pt-2 mt-1 border-t border-zinc-700' : ''}`}>
              <span className="w-36 shrink-0 text-xs text-zinc-400">{label}</span>
              <div className="flex-1 h-5 rounded bg-zinc-800 overflow-hidden">
                <div className={`h-full rounded transition-all ${barColor}`} style={{ width: `${pct}%` }} />
              </div>
              <span className={`w-28 shrink-0 text-right text-xs font-semibold tabular-nums ${textColor}`}>
                {type === 'negative' && val > 0 ? '−' : ''}{fmtINR(Math.abs(val))}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
