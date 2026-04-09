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
      <div className="rounded-2xl border border-green-800 bg-green-950 p-5">
        <p className="text-sm font-medium text-green-400">Total Income</p>
        <p className="mt-1 text-2xl font-bold text-green-300">{fmt(income)}</p>
      </div>
      <div className="rounded-2xl border border-red-800 bg-red-950 p-5">
        <p className="text-sm font-medium text-red-400">Total Expenses</p>
        <p className="mt-1 text-2xl font-bold text-red-300">{fmt(expenses)}</p>
      </div>
      <div className="rounded-2xl border border-blue-800 bg-blue-950 p-5">
        <p className="text-sm font-medium text-blue-400">Net Cash</p>
        <p className={`mt-1 text-2xl font-bold ${net >= 0 ? 'text-blue-300' : 'text-red-300'}`}>
          {fmt(net)}
        </p>
      </div>
    </div>
  )
}
