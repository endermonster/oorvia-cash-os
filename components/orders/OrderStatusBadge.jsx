const STYLES = {
  delivered: 'bg-green-900 text-green-300',
  shipped:   'bg-blue-900 text-blue-300',
  pending:   'bg-yellow-900 text-yellow-300',
  rto:       'bg-red-900 text-red-300',
  cancelled: 'bg-zinc-700 text-zinc-400',
}

export default function OrderStatusBadge({ status }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STYLES[status] || 'bg-zinc-700 text-zinc-400'}`}>
      {status}
    </span>
  )
}
