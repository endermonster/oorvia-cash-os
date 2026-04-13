import { fmtINR } from '@/lib/pnl'

const STEPS = [
  { key: 'gross_revenue',       label: 'Gross Revenue',       type: 'positive' },
  { key: 'rto_revenue_lost',    label: '− RTO Loss',          type: 'negative' },
  { key: 'actual_revenue',      label: '= Actual Revenue',    type: 'subtotal' },
  { key: 'total_checkout_fees', label: '− Checkout Fees',     type: 'negative' },
  { key: 'total_payment_gw_fees', label: '− Payment GW',     type: 'negative' },
  { key: 'total_3pl_charges',   label: '− 3PL Charges',       type: 'negative' },
  { key: 'total_rto_charges',   label: '− RTO Charges',       type: 'negative' },
  { key: 'total_ad_spend',      label: '− Meta Ad Spend',     type: 'negative' },
  { key: 'total_cogs',          label: '− COGS',              type: 'negative' },
  { key: 'net_profit',          label: '= Net Profit',        type: 'result' },
]

const barColors = {
  positive: 'bg-blue-600',
  negative: 'bg-red-800',
  subtotal: 'bg-zinc-600',
  result: 'bg-green-600',
}

export default function WaterfallCard({ pnl }) {
  const maxVal = Math.max(
    pnl?.gross_revenue || 0,
    1
  )

  return (
    <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-5">
      <h3 className="text-sm font-semibold text-zinc-100 mb-4">Revenue Waterfall</h3>
      <div className="space-y-1.5">
        {STEPS.map(({ key, label, type }) => {
          const val = Number(pnl?.[key] || 0)
          const pct = Math.max(0, Math.min(100, (Math.abs(val) / maxVal) * 100))
          const isResult = type === 'result'
          const isNegative = val < 0 || key === 'net_profit' && val < 0
          const displayColor = isResult
            ? val >= 0 ? 'text-green-400' : 'text-red-400'
            : type === 'negative' ? 'text-red-400' : 'text-zinc-200'
          const barColor = isResult
            ? val >= 0 ? 'bg-green-600' : 'bg-red-600'
            : barColors[type]

          return (
            <div key={key} className={`flex items-center gap-3 ${isResult ? 'pt-2 mt-1 border-t border-zinc-700' : ''}`}>
              <span className="w-36 shrink-0 text-xs text-zinc-400">{label}</span>
              <div className="flex-1 h-5 rounded bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full rounded transition-all ${barColor}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className={`w-28 shrink-0 text-right text-xs font-semibold tabular-nums ${displayColor}`}>
                {type === 'negative' && val > 0 ? '−' : ''}{fmtINR(Math.abs(val))}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
