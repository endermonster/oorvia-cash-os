'use client'

import { useEffect, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import MonthPicker from '@/components/shared/MonthPicker'
import { fmtINR, computeRunningBalance } from '@/lib/pnl'

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500'

const TYPE_STYLES = {
  credit:     'bg-emerald-950 text-emerald-400',
  add_funds:  'bg-sky-950 text-sky-400 border border-sky-800/50',
  debit:      'bg-red-950 text-red-400',
  withdrawal: 'bg-orange-900 text-orange-300',
}

const TYPE_LABELS = {
  credit:     'Credit',
  add_funds:  'Add Funds',
  debit:      'Debit',
  withdrawal: 'Withdrawal',
}

const IS_INFLOW = { credit: true, add_funds: true }

export default function CodWalletPage() {
  const [month, setMonth] = useState(currentMonth)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ entry_date: new Date().toISOString().slice(0, 10), entry_type: 'credit', amount: '', reference: '', notes: '' })
  const [saving, setSaving] = useState(false)

  const fetchEntries = async (m) => {
    setLoading(true)
    const res = await fetch(`/api/cod-wallet?month=${m}`)
    const data = await res.json()
    if (Array.isArray(data)) setEntries(computeRunningBalance(data))
    setLoading(false)
  }

  useEffect(() => { fetchEntries(month) }, [month])

  const handleAdd = async (e) => {
    e.preventDefault()
    setSaving(true)
    await fetch('/api/cod-wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
    })
    setShowForm(false)
    setForm({ entry_date: new Date().toISOString().slice(0, 10), entry_type: 'credit', amount: '', reference: '', notes: '' })
    fetchEntries(month)
    setSaving(false)
  }

  const totalInflows = entries.filter((e) => IS_INFLOW[e.entry_type]).reduce((s, e) => s + Number(e.amount), 0)
  const totalDebits = entries.filter((e) => e.entry_type === 'debit').reduce((s, e) => s + Number(e.amount), 0)
  const totalWithdrawals = entries.filter((e) => e.entry_type === 'withdrawal').reduce((s, e) => s + Number(e.amount), 0)
  const pendingDebits = entries.filter((e) => e.transaction_status === 'pending').reduce((s, e) => s + Number(e.amount), 0)
  const currentBalance = entries.length > 0 ? entries[entries.length - 1].running_balance : 0

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="COD Wallet"
        subtitle="vFulfill COD wallet ledger"
        actions={
          <>
            <MonthPicker monthStr={month} onChange={setMonth} />
            <button onClick={() => setShowForm((s) => !s)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
              + Add Entry
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard title="Current Balance" value={fmtINR(currentBalance)} color={currentBalance >= 0 ? 'green' : 'red'} subtitle="running total" />
        <StatCard title="Inflows" value={fmtINR(totalInflows)} color="green" subtitle="credits + add funds" />
        <StatCard title="Debits" value={fmtINR(totalDebits)} color="red" subtitle="fees & charges" />
        <StatCard title="Upcoming Debits" value={fmtINR(pendingDebits)} color={pendingDebits > 0 ? 'red' : 'zinc'} subtitle="pending transactions" />
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="rounded-2xl border border-slate-700 bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-100 mb-3">Add Wallet Entry</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Date</label>
              <input type="date" value={form.entry_date} onChange={(e) => setForm((p) => ({ ...p, entry_date: e.target.value }))} required className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Type</label>
              <select value={form.entry_type} onChange={(e) => setForm((p) => ({ ...p, entry_type: e.target.value }))} className={inputCls}>
                <option value="credit">Credit (COD remittance)</option>
                <option value="add_funds">Add Funds (wire / Razorpay)</option>
                <option value="debit">Debit (fee / charge)</option>
                <option value="withdrawal">Withdrawal</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Amount ₹</label>
              <input type="number" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} placeholder="0" min="0" step="0.01" required className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Reference</label>
              <input type="text" value={form.reference} onChange={(e) => setForm((p) => ({ ...p, reference: e.target.value }))} placeholder="vFulfill ref #" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1">Notes</label>
              <input type="text" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Optional" className={inputCls} />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
              {saving ? 'Saving…' : 'Add Entry'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="rounded-2xl border border-slate-700 bg-slate-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">Reference</th>
                  <th className="px-4 py-3 text-right">Running Balance</th>
                  <th className="px-4 py-3 text-left">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {entries.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No wallet entries this month.</td></tr>
                ) : [...entries].reverse().map((e) => (
                  <tr key={e.id} className="hover:bg-slate-800/60">
                    <td className="px-4 py-3 text-slate-300 text-xs whitespace-nowrap">{new Date(e.entry_date).toLocaleDateString('en-IN')}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_STYLES[e.entry_type] || 'bg-slate-700 text-slate-400'}`}>
                        {TYPE_LABELS[e.entry_type] || e.entry_type}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${IS_INFLOW[e.entry_type] ? 'text-green-400' : 'text-red-400'}`}>
                      {IS_INFLOW[e.entry_type] ? '+' : '−'}{fmtINR(e.amount)}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{e.reference || '—'}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${e.running_balance >= 0 ? 'text-slate-200' : 'text-red-400'}`}>
                      {fmtINR(e.running_balance)}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-[160px] truncate">{e.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
