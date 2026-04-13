import { fmtINR } from '@/lib/pnl'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// history: array of monthly_pnl rows sorted ascending by month
export default function MonthlyBarChart({ history }) {
  if (!history || history.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-5">
        <h3 className="text-sm font-semibold text-zinc-100 mb-4">Month-on-Month</h3>
        <p className="text-sm text-zinc-500 text-center py-8">No historical data yet. Recompute multiple months to see the chart.</p>
      </div>
    )
  }

  const maxVal = Math.max(...history.map((h) => h.actual_revenue || 0), 1)

  return (
    <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-5">
      <h3 className="text-sm font-semibold text-zinc-100 mb-1">Month-on-Month</h3>
      <div className="flex gap-2 text-xs text-zinc-500 mb-4">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-blue-600"></span> Actual Revenue</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-green-600"></span> Net Profit</span>
      </div>

      <div className="flex items-end gap-3 h-40">
        {history.map((h) => {
          const d = new Date(h.month)
          const label = `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
          const revPct = Math.max(0, ((h.actual_revenue || 0) / maxVal) * 100)
          const profitPct = Math.max(0, ((Math.max(0, h.net_profit || 0)) / maxVal) * 100)
          const isLoss = (h.net_profit || 0) < 0

          return (
            <div key={h.month} className="flex-1 flex flex-col items-center gap-1 group">
              {/* Tooltip on hover */}
              <div className="hidden group-hover:block absolute z-10 bg-zinc-800 border border-zinc-600 rounded-lg p-2 text-xs text-zinc-200 shadow-xl pointer-events-none -translate-y-full">
                <p className="font-semibold mb-0.5">{label}</p>
                <p>Revenue: {fmtINR(h.actual_revenue || 0)}</p>
                <p>Net: {fmtINR(h.net_profit || 0)}</p>
              </div>

              {/* Bars */}
              <div className="w-full flex items-end gap-0.5 h-36 relative">
                <div
                  className="flex-1 rounded-t bg-blue-600/80 hover:bg-blue-500 transition-colors cursor-default"
                  style={{ height: `${revPct}%`, minHeight: revPct > 0 ? '2px' : '0' }}
                  title={`Revenue: ${fmtINR(h.actual_revenue || 0)}`}
                />
                <div
                  className={`flex-1 rounded-t transition-colors cursor-default ${isLoss ? 'bg-red-700/80 hover:bg-red-600' : 'bg-green-600/80 hover:bg-green-500'}`}
                  style={{ height: `${isLoss ? 4 : profitPct}%`, minHeight: '2px' }}
                  title={`Net: ${fmtINR(h.net_profit || 0)}`}
                />
              </div>
              <span className="text-[10px] text-zinc-500">{label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
