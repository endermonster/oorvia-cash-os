'use client'

import { useEffect, useRef, useState } from 'react'

const PAGE_SIZE = 10

const SOURCES = [
  'vFulfill Wallet',
  'vFulfill Membership',
  'Cashfree',
  'Meta Ads',
  'Checkout Service',
  'Owner Infusion',
  'Miscellaneous',
]

const fmt = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

const TYPE_STYLES = {
  income: 'bg-green-900 text-green-300',
  expense: 'bg-red-900 text-red-300',
  transfer: 'bg-yellow-900 text-yellow-300',
}

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500'

// ── Three-dot row menu ──────────────────────────────────────────────
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
              <path d="M5 4V2h6v2" />
              <path d="M6 7v5M10 7v5" />
              <path d="M3 4l1 10h8l1-10" />
            </svg>
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Edit modal ──────────────────────────────────────────────────────
function EditModal({ tx, onSave, onClose }) {
  const [form, setForm] = useState({
    date: tx.date,
    amount: tx.amount,
    type: tx.type,
    source: tx.source,
    category: tx.category || '',
    notes: tx.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const handleChange = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const res = await fetch('/api/transactions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: tx.id, ...form, amount: parseFloat(form.amount) }),
    })

    if (!res.ok) {
      const d = await res.json()
      setError(d.error || 'Failed to save')
      setSaving(false)
      return
    }

    const updated = await res.json()
    onSave(updated)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-zinc-100">Edit Transaction</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 transition-colors">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="2" y1="2" x2="14" y2="14" /><line x1="14" y1="2" x2="2" y2="14" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Date</label>
            <input type="date" name="date" value={form.date} onChange={handleChange} required className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Amount (₹)</label>
            <input type="number" name="amount" value={form.amount} onChange={handleChange} min="0" step="0.01" required className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Type</label>
            <select name="type" value={form.type} onChange={handleChange} className={inputCls}>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
              <option value="transfer">Transfer</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Source</label>
            <select name="source" value={form.source} onChange={handleChange} className={inputCls}>
              {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Category</label>
            <input type="text" name="category" value={form.category} onChange={handleChange} placeholder="e.g. Ads, Shipping" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Notes</label>
            <input type="text" name="notes" value={form.notes} onChange={handleChange} placeholder="Optional" className={inputCls} />
          </div>

          {error && <p className="col-span-full text-sm text-red-400">{error}</p>}

          <div className="col-span-full flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main table ──────────────────────────────────────────────────────
export default function TransactionTable({ transactions, onDelete, onEdit }) {
  const [page, setPage] = useState(1)
  const [deleting, setDeleting] = useState(null)
  const [editing, setEditing] = useState(null)

  const handleDelete = async (id) => {
    setDeleting(id)
    const res = await fetch('/api/transactions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) onDelete(id)
    setDeleting(null)
  }

  const handleSave = (updated) => {
    onEdit(updated)
    setEditing(null)
  }

  const totalPages = Math.max(1, Math.ceil(transactions.length / PAGE_SIZE))
  const slice = transactions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <>
      {editing && (
        <EditModal tx={editing} onSave={handleSave} onClose={() => setEditing(null)} />
      )}

      <div className="rounded-2xl border border-zinc-700 bg-zinc-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-800 text-xs font-semibold text-zinc-400 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Source</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-left">Notes</th>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {slice.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                    No transactions yet.
                  </td>
                </tr>
              ) : (
                slice.map((t) => (
                  <tr key={t.id} className="hover:bg-zinc-800/60">
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-200">
                      {new Date(t.date).toLocaleDateString('en-IN')}
                    </td>
                    <td className="px-4 py-3 text-zinc-200">{t.source}</td>
                    <td className="px-4 py-3 text-zinc-300">{t.category || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${TYPE_STYLES[t.type] || 'bg-zinc-700 text-zinc-300'}`}>
                        {t.type}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${t.type === 'expense' ? 'text-red-400' : t.type === 'income' ? 'text-green-400' : 'text-zinc-200'}`}>
                      {t.type === 'expense' ? '−' : '+'}{fmt(t.amount)}
                    </td>
                    <td className="px-4 py-3 text-zinc-400 max-w-xs truncate">{t.notes || '—'}</td>
                    <td className="px-4 py-3">
                      <RowMenu
                        onEdit={() => setEditing(t)}
                        onDelete={() => handleDelete(t.id)}
                        deleting={deleting === t.id}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-zinc-700 px-4 py-3">
            <span className="text-xs text-zinc-500">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-lg border border-zinc-600 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded-lg border border-zinc-600 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
