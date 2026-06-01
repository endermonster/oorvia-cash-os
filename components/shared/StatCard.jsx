// color: 'green' | 'red' | 'blue' | 'zinc' (default)
export default function StatCard({ title, value, subtitle, color = 'zinc' }) {
  const configs = {
    green: { bar: 'bg-emerald-500', val: 'text-emerald-400' },
    red:   { bar: 'bg-red-500',     val: 'text-red-400'     },
    blue:  { bar: 'bg-sky-500',     val: 'text-sky-400'     },
    zinc:  { bar: 'bg-slate-600',   val: 'text-slate-100'   },
  }
  const { bar, val } = configs[color] || configs.zinc

  return (
    <div className="relative rounded-xl border border-slate-800 bg-slate-900/60 p-5 overflow-hidden">
      <div className={`absolute left-0 inset-y-0 w-0.5 rounded-full ${bar}`} />
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">{title}</p>
      <p className={`text-2xl font-bold font-mono tabular-nums leading-none ${val}`}>{value}</p>
      {subtitle && <p className="text-xs text-slate-600 mt-1.5">{subtitle}</p>}
    </div>
  )
}
