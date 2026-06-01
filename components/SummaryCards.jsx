const fmt = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

export default function SummaryCards({ transactions }) {
  const income = transactions
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + Number(t.amount), 0)

  const expenses = transactions
    .filter((t) => t.type === 'expense')
    .reduce((sum, t) => sum + Number(t.amount), 0)

  const net = income - expenses

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="relative rounded-xl border border-slate-800 bg-slate-900/60 p-5 overflow-hidden">
        <div className="absolute left-0 inset-y-0 w-0.5 rounded-full bg-emerald-500" />
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Total Income</p>
        <p className="text-2xl font-bold font-mono tabular-nums text-emerald-400">{fmt(income)}</p>
      </div>
      <div className="relative rounded-xl border border-slate-800 bg-slate-900/60 p-5 overflow-hidden">
        <div className="absolute left-0 inset-y-0 w-0.5 rounded-full bg-red-500" />
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Total Expenses</p>
        <p className="text-2xl font-bold font-mono tabular-nums text-red-400">{fmt(expenses)}</p>
      </div>
      <div className="relative rounded-xl border border-slate-800 bg-slate-900/60 p-5 overflow-hidden">
        <div className="absolute left-0 inset-y-0 w-0.5 rounded-full bg-sky-500" />
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Net Cash</p>
        <p className={`text-2xl font-bold font-mono tabular-nums ${net >= 0 ? 'text-sky-400' : 'text-red-400'}`}>
          {fmt(net)}
        </p>
      </div>
    </div>
  )
}
