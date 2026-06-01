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
        className="rounded-md p-1.5 text-slate-600 hover:bg-slate-700 hover:text-slate-300 transition-colors cursor-pointer"
        aria-label="Row actions"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="3" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="8" cy="13" r="1.4" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 w-32 rounded-xl border border-slate-700 bg-slate-800 py-1 shadow-xl shadow-black/40">
          <button
            onClick={() => { setOpen(false); onEdit() }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 cursor-pointer"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11.5 2.5a2.121 2.121 0 0 1 3 3L5 15H1v-4L11.5 2.5z" />
            </svg>
            Edit
          </button>
          <button
            onClick={() => { setOpen(false); onDelete() }}
            disabled={deleting}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
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

  const handleDelete = async (name) => {
    setDeleting(name)
    const res = await fetch(`/api/orders/${encodeURIComponent(name)}`, { method: 'DELETE' })
    if (res.ok) onDelete(name)
    setDeleting(null)
  }

  const totalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE))
  const slice = orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (orders.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-12 text-center text-slate-500 text-sm">
        No orders found. Import a vFulfill transaction export to get started.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-800/50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Order ID</th>
              <th className="px-4 py-3 text-left">State</th>
              <th className="px-4 py-3 text-left">Mode</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Settlement</th>
              <th className="px-4 py-3 text-right">Revenue</th>
              <th className="px-4 py-3 text-right">Net P&L</th>
              <th className="px-4 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {slice.map((o) => {
              const net   = computeOrderNetProfit(o)
              const isRTO = o.status === 'rto'
              const isCOD = o.payment_type === 'cash_on_delivery'
              const modeLabel = isCOD ? 'COD' : o.payment_type?.startsWith('prepaid') ? 'Prepaid' : (o.payment_type ?? '—').toUpperCase()
              const key   = o.shopify_order_name ?? o.id
              return (
                <tr key={key} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap text-slate-400 text-xs tabular-nums">
                    {new Date(o.order_date).toLocaleDateString('en-IN')}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs font-mono">
                    {o.shopify_order_name || o.shopify_order_id || <span className="text-slate-700">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {o.ship_state || o.customer_state || <span className="text-slate-700">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${isCOD ? 'bg-orange-950 text-orange-400 border border-orange-800/50' : 'bg-indigo-950 text-indigo-400 border border-indigo-800/50'}`}>
                      {modeLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <OrderStatusBadge status={o.status} />
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {o.settlement_status ? (
                      <span className={`rounded-full px-2 py-0.5 font-medium ${
                        o.settlement_status === 'settled'    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/50' :
                        o.settlement_status === 'in-transit' ? 'bg-yellow-950 text-yellow-400 border border-yellow-800/50' :
                                                               'bg-slate-800 text-slate-500'
                      }`}>
                        {o.settlement_status}
                      </span>
                    ) : <span className="text-slate-700">—</span>}
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap font-mono tabular-nums ${isRTO ? 'text-red-400 line-through' : 'text-slate-200'}`}>
                    {fmtINR(o.order_value)}
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap font-mono tabular-nums ${net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {net >= 0 ? '+' : ''}{fmtINR(net)}
                  </td>
                  <td className="px-4 py-3">
                    <RowMenu
                      onEdit={() => onEdit(o)}
                      onDelete={() => handleDelete(key)}
                      deleting={deleting === key}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3">
          <span className="text-xs text-slate-600">Page {page} of {totalPages} · {orders.length} orders</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40 cursor-pointer">
              Prev
            </button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40 cursor-pointer">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
