import { fmtINR } from '@/lib/pnl'

const STEPS = [
  { key: 'revenue_net',           label: 'Revenue (net GST)',    type: 'positive' },
  { key: 'variable_costs',        label: '− Variable Costs',     type: 'negative' },
  { key: 'cogs',                  label: '− COGS',               type: 'negative' },
  { key: 'fixed_costs_prorated',  label: '− Fixed Costs',        type: 'negative' },
  { key: 'marketing_net',         label: '− Marketing',          type: 'negative' },
  { key: 'net_profit',            label: '= Net Profit',         type: 'result'   },
]

export default function WaterfallCard({ pnl }) {
  if (!pnl) return null
  const maxVal = Math.max(pnl.revenue_net || 0, 1)

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Revenue Waterfall</h3>
      <div className="space-y-1.5">
        {STEPS.map(({ key, label, type }) => {
          const val  = Number(pnl[key] || 0)
          const pct  = Math.max(0, Math.min(100, (Math.abs(val) / maxVal) * 100))
          const isResult = type === 'result'
          const barColor = isResult
            ? (val >= 0 ? 'bg-emerald-600' : 'bg-red-600')
            : type === 'negative' ? 'bg-red-800' : 'bg-sky-600'
          const textColor = isResult
            ? (val >= 0 ? 'text-emerald-400' : 'text-red-400')
            : type === 'negative' ? 'text-red-400' : 'text-slate-200'

          return (
            <div key={key} className={`flex items-center gap-3 ${isResult ? 'pt-2 mt-1 border-t border-slate-800' : ''}`}>
              <span className="w-36 shrink-0 text-xs text-slate-500">{label}</span>
              <div className="flex-1 h-4 rounded-sm bg-slate-800 overflow-hidden">
                <div className={`h-full rounded-sm transition-all ${barColor}`} style={{ width: `${pct}%` }} />
              </div>
              <span className={`w-28 shrink-0 text-right text-xs font-semibold tabular-nums font-mono ${textColor}`}>
                {type === 'negative' && val > 0 ? '−' : ''}{fmtINR(Math.abs(val))}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
