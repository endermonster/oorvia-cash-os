// Reusable metric card.
// color: 'green' | 'red' | 'blue' | 'zinc' (default)
export default function StatCard({ title, value, subtitle, color = 'zinc' }) {
  const valueColors = {
    green: 'text-green-400',
    red: 'text-red-400',
    blue: 'text-blue-400',
    zinc: 'text-zinc-100',
  }
  return (
    <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-5">
      <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">{title}</p>
      <p className={`text-2xl font-bold ${valueColors[color] || 'text-zinc-100'}`}>{value}</p>
      {subtitle && <p className="text-xs text-zinc-500 mt-1">{subtitle}</p>}
    </div>
  )
}
