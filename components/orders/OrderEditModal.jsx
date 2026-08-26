'use client'

import { useState } from 'react'
import { fmtINR } from '@/lib/pnl'
import { today, fmtDate } from '@/lib/dates'
import { ORDER_STATUS, ORDER_STATUS_LIST, ORDER_STATUS_LABELS, PAYMENT_TYPE_LABELS } from '@/lib/constants'

// Orders originate from the Shopify sync and the vFulfill import — never by hand.
// This corrects the two fields those pipelines can get wrong: the status, and the
// delivery date that decides which P&L month and GST return the order lands in.
// Everything else is read-only on purpose; editing it here would only make the
// dashboard disagree with Shopify.

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500'

function ReadOnlyField({ label, value }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-500">{label}</p>
      <p className="text-sm text-slate-300">{value ?? '—'}</p>
    </div>
  )
}

export default function OrderEditModal({ order, onSaved, onClose }) {
  const [status, setStatus] = useState(order.status)
  const [deliveredAt, setDeliveredAt] = useState(
    order.delivered_at ? String(order.delivered_at).slice(0, 10) : today()
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const needsDeliveryDate = status === ORDER_STATUS.DELIVERED
  const wasDelivered = order.status === ORDER_STATUS.DELIVERED
  const leavingDelivered = wasDelivered && !needsDeliveryDate

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const payload = { status }
    if (needsDeliveryDate) payload.delivered_at = deliveredAt

    const res = await fetch(`/api/orders/${encodeURIComponent(order.shopify_order_name)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Could not update this order.')
      setLoading(false)
      return
    }

    onSaved(await res.json())
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-6">
      <div className="my-auto w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Correct order status</h2>
            <p className="mt-0.5 font-mono text-xs text-slate-500">{order.shopify_order_name}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-slate-500 transition-colors hover:text-slate-200 cursor-pointer"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="2" y1="2" x2="14" y2="14" /><line x1="14" y1="2" x2="2" y2="14" />
            </svg>
          </button>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <ReadOnlyField label="Order date" value={fmtDate(order.order_date)} />
          <ReadOnlyField label="Order value" value={fmtINR(order.order_value)} />
          <ReadOnlyField label="Payment" value={PAYMENT_TYPE_LABELS[order.payment_type] || order.payment_type} />
          <ReadOnlyField label="Ship state" value={order.ship_state} />
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label htmlFor="order-status" className="mb-1 block text-xs font-medium text-slate-400">Status</label>
            <select
              id="order-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={inputCls}
            >
              {ORDER_STATUS_LIST.map((s) => (
                <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>

          {needsDeliveryDate && (
            <div className="mb-3">
              <label htmlFor="order-delivered-at" className="mb-1 block text-xs font-medium text-slate-400">
                Delivered on
              </label>
              <input
                id="order-delivered-at"
                type="date"
                required
                value={deliveredAt}
                max={today()}
                onChange={(e) => setDeliveredAt(e.target.value)}
                className={inputCls}
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Decides which P&amp;L month and GST return this order counts in.
              </p>
            </div>
          )}

          {leavingDelivered && (
            <p className="mb-3 rounded-lg border border-yellow-900/60 bg-yellow-950/30 px-3 py-2 text-xs text-yellow-400">
              Moving this out of Delivered clears its delivery date and removes its revenue
              from the month it was counted in.
            </p>
          )}

          {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || status === order.status}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
