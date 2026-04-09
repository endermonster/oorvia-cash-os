'use client'

import { useState } from 'react'

const SOURCES = [
  'vFulfill Wallet',
  'vFulfill Membership',
  'Cashfree',
  'Meta Ads',
  'Checkout Service',
  'Owner Infusion',
  'Miscellaneous',
]

const defaultForm = {
  date: new Date().toISOString().slice(0, 10),
  amount: '',
  type: 'expense',
  source: SOURCES[0],
  category: '',
  notes: '',
}

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500'

export default function TransactionForm({ onAdded }) {
  const [form, setForm] = useState(defaultForm)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error || 'Something went wrong')
      setLoading(false)
      return
    }

    const newTx = await res.json()
    onAdded(newTx)
    setForm(defaultForm)
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-zinc-700 bg-zinc-900 p-5">
      <h2 className="mb-4 text-base font-semibold text-zinc-100">Add Transaction</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Date</label>
          <input type="date" name="date" value={form.date} onChange={handleChange} required className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Amount (₹)</label>
          <input
            type="number"
            name="amount"
            value={form.amount}
            onChange={handleChange}
            placeholder="0"
            min="0"
            step="0.01"
            required
            className={inputCls}
          />
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
            {SOURCES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Category</label>
          <input
            type="text"
            name="category"
            value={form.category}
            onChange={handleChange}
            placeholder="e.g. Ads, Shipping"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Notes</label>
          <input
            type="text"
            name="notes"
            value={form.notes}
            onChange={handleChange}
            placeholder="Optional"
            className={inputCls}
          />
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="mt-4 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {loading ? 'Saving…' : 'Add Transaction'}
      </button>
    </form>
  )
}
