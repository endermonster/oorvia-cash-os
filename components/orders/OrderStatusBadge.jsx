import { ORDER_STATUS, ORDER_STATUS_LABELS } from '@/lib/constants'

// Keyed off the real statuses in the database. 'pending' and 'shipped' never
// existed here — 'unfulfilled' and 'active' do, and used to fall through to grey.
const STYLES = {
  [ORDER_STATUS.UNFULFILLED]: 'bg-amber-950 text-amber-400 border border-amber-800/50',
  [ORDER_STATUS.ACTIVE]:      'bg-sky-950 text-sky-400 border border-sky-800/50',
  [ORDER_STATUS.DELIVERED]:   'bg-emerald-950 text-emerald-400 border border-emerald-800/50',
  [ORDER_STATUS.RTO]:         'bg-red-950 text-red-400 border border-red-800/50',
  [ORDER_STATUS.CANCELLED]:   'bg-slate-800 text-slate-500',
}

export default function OrderStatusBadge({ status }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status] || 'bg-slate-800 text-slate-500'}`}>
      {ORDER_STATUS_LABELS[status] || status || '—'}
    </span>
  )
}
