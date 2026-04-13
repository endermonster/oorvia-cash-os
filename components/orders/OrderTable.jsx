'use client'

import { useEffect, useRef, useState } from 'react'
import OrderStatusBadge from './OrderStatusBadge'
import { fmtINR, computeOrderNetProfit } from '@/lib/pnl'

const PAGE_SIZE = 15

function RowMenu({ onEdit, onDelete, deleting }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative flex justify-end">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
        aria-label="Row actions"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="3" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="8" cy="13" r="1.4" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 w-32 rounded-xl border border-zinc-700 bg-zinc-800 py-1 shadow-xl">
          <button
            onClick={() => { setOpen(false); onEdit() }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11.5 2.5a2.121 2.121 0 0 1 3 3L5 15H1v-4L11.5 2.5z" />
            </svg>
            Edit
          </button>
          <button
            onClick={() => { setOpen(false); onDelete() }}
            disabled={deleting}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-zinc-700 disabled:opacity-40"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="2 4 14 4" />
              <path d="M5 4V2h6v2M3 4l1 10h8l1-10" />
            </svg>
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function OrderTable({ orders, onEdit, onDelete }) {
  const [page, setPage] = useState(1)
  const [deleting, setDeleting] = useState(null)

  const handleDelete = async (id) => {
    setDeleting(id)
    const res = await fetch(`/api/orders/${id}`, { method: 'DELETE' })
    if (res.ok) onDelete(id)
    setDeleting(null)
  }

  const totalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE))
  const slice = orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (orders.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-12 text-center text-zinc-500 text-sm">
        No orders found. Add your first order above.
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-zinc-700 bg-zinc-900 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-800 text-xs font-semibold text-zinc-400 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Order ID</th>
              <th className="px-4 py-3 text-left">Product</th>
              <th className="px-4 py-3 text-left">Mode</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-right">Revenue</th>
              <th className="px-4 py-3 text-right">Net P&L</th>
              <th className="px-4 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {slice.map((o) => {
              const net = computeOrderNetProfit(o)
              const isRTO = o.status === 'rto'
              return (
                <tr key={o.id} className="hover:bg-zinc-800/60">
                  <td className="px-4 py-3 whitespace-nowrap text-zinc-300 text-xs">
                    {new Date(o.order_date).toLocaleDateString('en-IN')}
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">
                    {o.shopify_order_id || <span className="text-zinc-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-zinc-200 max-w-[140px] truncate">
                    {o.products?.name || <span className="text-zinc-600">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${o.payment_mode === 'cod' ? 'bg-orange-900 text-orange-300' : 'bg-indigo-900 text-indigo-300'}`}>
                      {o.payment_mode.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <OrderStatusBadge status={o.status} />
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${isRTO ? 'text-red-400 line-through' : 'text-zinc-200'}`}>
                    {fmtINR(o.selling_price)}
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {net >= 0 ? '+' : ''}{fmtINR(net)}
                  </td>
                  <td className="px-4 py-3">
                    <RowMenu
                      onEdit={() => onEdit(o)}
                      onDelete={() => handleDelete(o.id)}
                      deleting={deleting === o.id}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-zinc-700 px-4 py-3">
          <span className="text-xs text-zinc-500">Page {page} of {totalPages} · {orders.length} orders</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              className="rounded-lg border border-zinc-600 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40">
              Prev
            </button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="rounded-lg border border-zinc-600 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
