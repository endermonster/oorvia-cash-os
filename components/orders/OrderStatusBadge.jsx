const STYLES = {
  delivered: 'bg-emerald-950 text-emerald-400 border border-emerald-800/50',
  shipped:   'bg-sky-950 text-sky-400 border border-sky-800/50',
  pending:   'bg-yellow-950 text-yellow-400 border border-yellow-800/50',
  rto:       'bg-red-950 text-red-400 border border-red-800/50',
  cancelled: 'bg-slate-800 text-slate-500',
}

export default function OrderStatusBadge({ status }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STYLES[status] || 'bg-slate-800 text-slate-500'}`}>
      {status}
    </span>
  )
}
