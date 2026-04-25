'use client'

import { useEffect, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import { fmtINR } from '@/lib/pnl'

const inp = 'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500'
const sel = `${inp} cursor-pointer`
const btn = 'rounded-lg px-3 py-1.5 text-sm font-medium transition'

const TABS = ['Fixed Costs', 'Marketing Spend', 'Capital & Loans', 'Wallet']

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <p className="text-base font-semibold text-zinc-100">{title}</p>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 shrink-0">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l10 10M14 4L4 14"/></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function DeleteBtn({ onDelete }) {
  return (
    <button onClick={onDelete} className={`${btn} bg-red-900/60 hover:bg-red-800 text-red-300`}>Delete</button>
  )
}

function EmptyRow({ cols, msg }) {
  return <tr><td colSpan={cols} className="px-4 py-8 text-center text-sm text-zinc-500">{msg}</td></tr>
}

// ---------------------------------------------------------------------------
// Fixed Costs tab
// ---------------------------------------------------------------------------

const blankFC = { name: '', amount: '', frequency: 'monthly', start_date: '', end_date: '', category: '', gst_inclusive: false }

function FixedCostsTab() {
  const [rows, setRows]       = useState([])
  const [show, setShow]       = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm]       = useState(blankFC)
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState(null)

  const load = () => fetch('/api/fixed-costs').then((r) => r.json()).then((d) => Array.isArray(d) && setRows(d))
  useEffect(() => { load() }, [])

  const openAdd  = () => { setForm(blankFC); setEditing(null); setErr(null); setShow(true) }
  const openEdit = (r) => { setForm({ name: r.name, amount: r.amount, frequency: r.frequency, start_date: r.start_date, end_date: r.end_date ?? '', category: r.category ?? '', gst_inclusive: r.gst_inclusive }); setEditing(r); setErr(null); setShow(true) }

  const save = async (e) => {
    e.preventDefault(); setSaving(true); setErr(null)
    const method = editing ? 'PATCH' : 'POST'
    const body   = editing ? { id: editing.id, ...form } : form
    const res    = await fetch('/api/fixed-costs', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data   = await res.json()
    if (!res.ok) { setErr(data.error || 'Failed'); setSaving(false); return }
    setShow(false); load(); setSaving(false)
  }

  const del = async (id) => {
    if (!confirm('Delete this fixed cost?')) return
    await fetch('/api/fixed-costs', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    load()
  }

  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  return (
    <>
      <div className="flex justify-end mb-4">
        <button onClick={openAdd} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white px-4 py-2`}>+ Add Fixed Cost</button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-zinc-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-700 text-xs text-zinc-500 uppercase tracking-wider">
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Category</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-left">Frequency</th>
              <th className="px-4 py-3 text-left">Active</th>
              <th className="px-4 py-3 text-right">GST Incl.</th>
              <th className="px-4 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {rows.length === 0 ? <EmptyRow cols={7} msg="No fixed costs yet." /> : rows.map((r) => (
              <tr key={r.id} className="hover:bg-zinc-800/40">
                <td className="px-4 py-3 text-zinc-100">{r.name}</td>
                <td className="px-4 py-3 text-zinc-400">{r.category || '—'}</td>
                <td className="px-4 py-3 text-right text-zinc-100 font-medium">{fmtINR(r.amount)}</td>
                <td className="px-4 py-3 text-zinc-400 capitalize">{r.frequency}</td>
                <td className="px-4 py-3 text-zinc-400 text-xs">{r.start_date} → {r.end_date || '∞'}</td>
                <td className="px-4 py-3 text-right text-zinc-400">{r.gst_inclusive ? 'Yes' : 'No'}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => openEdit(r)} className={`${btn} bg-zinc-700 hover:bg-zinc-600 text-zinc-200`}>Edit</button>
                    <DeleteBtn onDelete={() => del(r.id)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {show && (
        <Modal title={editing ? 'Edit Fixed Cost' : 'Add Fixed Cost'} onClose={() => setShow(false)}>
          <form onSubmit={save} className="space-y-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Name *</label>
              <input className={inp} required value={form.name} onChange={f('name')} placeholder="e.g. Warehouse rent" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Amount (₹) *</label>
                <input className={inp} type="number" step="0.01" required value={form.amount} onChange={f('amount')} />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Frequency *</label>
                <select className={sel} value={form.frequency} onChange={f('frequency')}>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                  <option value="one-time">One-time</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Start Date *</label>
                <input className={inp} type="date" required value={form.start_date} onChange={f('start_date')} />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">End Date (leave blank if active)</label>
                <input className={inp} type="date" value={form.end_date} onChange={f('end_date')} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Category</label>
              <input className={inp} value={form.category} onChange={f('category')} placeholder="e.g. Logistics, SaaS" />
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
              <input type="checkbox" checked={form.gst_inclusive} onChange={f('gst_inclusive')} className="rounded" />
              Amount is GST-inclusive
            </label>
            {err && <p className="text-sm text-red-400">{err}</p>}
            <button type="submit" disabled={saving} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white w-full py-2 disabled:opacity-40`}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add'}
            </button>
          </form>
        </Modal>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Marketing Spend tab
// ---------------------------------------------------------------------------

const blankMS = { platform: 'meta', amount: '', date: '', campaign: '', gst_amt: '' }

function MarketingSpendTab() {
  const [rows, setRows]     = useState([])
  const [show, setShow]     = useState(false)
  const [form, setForm]     = useState(blankMS)
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)

  const load = () => fetch('/api/marketing-spend').then((r) => r.json()).then((d) => Array.isArray(d) && setRows(d))
  useEffect(() => { load() }, [])

  const save = async (e) => {
    e.preventDefault(); setSaving(true); setErr(null)
    const res  = await fetch('/api/marketing-spend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const data = await res.json()
    if (!res.ok) { setErr(data.error || 'Failed'); setSaving(false); return }
    setShow(false); setForm(blankMS); load(); setSaving(false)
  }

  const del = async (id) => {
    if (!confirm('Delete this entry?')) return
    await fetch('/api/marketing-spend', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    load()
  }

  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))
  const totalSpend = rows.reduce((s, r) => s + Number(r.amount), 0)
  const totalGst   = rows.reduce((s, r) => s + Number(r.gst_amt), 0)

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-6">
          <div><p className="text-xs text-zinc-500">Total Spend (gross)</p><p className="text-lg font-bold text-zinc-100">{fmtINR(totalSpend)}</p></div>
          <div><p className="text-xs text-zinc-500">Input GST (ITC)</p><p className="text-lg font-bold text-blue-400">{fmtINR(totalGst)}</p></div>
        </div>
        <button onClick={() => { setShow(true); setErr(null) }} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white px-4 py-2`}>+ Add Spend</button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-zinc-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-700 text-xs text-zinc-500 uppercase tracking-wider">
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Platform</th>
              <th className="px-4 py-3 text-left">Campaign</th>
              <th className="px-4 py-3 text-right">Gross</th>
              <th className="px-4 py-3 text-right">GST (ITC)</th>
              <th className="px-4 py-3 text-right">Net</th>
              <th className="px-4 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {rows.length === 0 ? <EmptyRow cols={7} msg="No marketing spend entries yet." /> : rows.map((r) => (
              <tr key={r.id} className="hover:bg-zinc-800/40">
                <td className="px-4 py-3 text-zinc-400 text-xs">{r.date}</td>
                <td className="px-4 py-3 text-zinc-100 capitalize">{r.platform}</td>
                <td className="px-4 py-3 text-zinc-400">{r.campaign || '—'}</td>
                <td className="px-4 py-3 text-right text-zinc-100">{fmtINR(r.amount)}</td>
                <td className="px-4 py-3 text-right text-blue-400">{fmtINR(r.gst_amt)}</td>
                <td className="px-4 py-3 text-right text-zinc-100">{fmtINR(r.amount - r.gst_amt)}</td>
                <td className="px-4 py-3 text-right"><DeleteBtn onDelete={() => del(r.id)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {show && (
        <Modal title="Add Marketing Spend" onClose={() => setShow(false)}>
          <form onSubmit={save} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Platform *</label>
                <input className={inp} required value={form.platform} onChange={f('platform')} placeholder="meta / google" />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Date *</label>
                <input className={inp} type="date" required value={form.date} onChange={f('date')} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Gross Amount (₹) *</label>
                <input className={inp} type="number" step="0.01" required value={form.amount} onChange={f('amount')} />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">GST Amount (₹)</label>
                <input className={inp} type="number" step="0.01" value={form.gst_amt} onChange={f('gst_amt')} placeholder="0.00" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Campaign (optional)</label>
              <input className={inp} value={form.campaign} onChange={f('campaign')} placeholder="Campaign name or ID" />
            </div>
            {err && <p className="text-sm text-red-400">{err}</p>}
            <button type="submit" disabled={saving} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white w-full py-2 disabled:opacity-40`}>
              {saving ? 'Saving…' : 'Add'}
            </button>
          </form>
        </Modal>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Capital & Loans tab
// ---------------------------------------------------------------------------

const blankCI = { contributor_name: '', contributor_type: 'partner', amount: '', date: '', interest_rate: '', repayment_due: '', repaid_amount: '0', note: '' }

function CapitalTab() {
  const [rows, setRows]       = useState([])
  const [show, setShow]       = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm]       = useState(blankCI)
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState(null)

  const load = () => fetch('/api/capital-infusions').then((r) => r.json()).then((d) => Array.isArray(d) && setRows(d))
  useEffect(() => { load() }, [])

  const openAdd  = () => { setForm(blankCI); setEditing(null); setErr(null); setShow(true) }
  const openEdit = (r) => {
    setForm({ contributor_name: r.contributor_name, contributor_type: r.contributor_type, amount: r.amount, date: r.date, interest_rate: r.interest_rate ? (r.interest_rate * 100).toFixed(2) : '', repayment_due: r.repayment_due ?? '', repaid_amount: r.repaid_amount ?? '0', note: r.note ?? '' })
    setEditing(r); setErr(null); setShow(true)
  }

  const save = async (e) => {
    e.preventDefault(); setSaving(true); setErr(null)
    const method = editing ? 'PATCH' : 'POST'
    const body   = editing ? { id: editing.id, repaid_amount: form.repaid_amount, note: form.note, repayment_due: form.repayment_due } : form
    const res    = await fetch('/api/capital-infusions', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data   = await res.json()
    if (!res.ok) { setErr(data.error || 'Failed'); setSaving(false); return }
    setShow(false); load(); setSaving(false)
  }

  const del = async (id) => {
    if (!confirm('Delete this entry?')) return
    await fetch('/api/capital-infusions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    load()
  }

  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))
  const totalIn    = rows.reduce((s, r) => s + Number(r.amount), 0)
  const totalRepaid = rows.filter((r) => r.contributor_type === 'loan').reduce((s, r) => s + Number(r.repaid_amount), 0)

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-6">
          <div><p className="text-xs text-zinc-500">Total Capital In</p><p className="text-lg font-bold text-green-400">{fmtINR(totalIn)}</p></div>
          <div><p className="text-xs text-zinc-500">Loans Repaid</p><p className="text-lg font-bold text-zinc-100">{fmtINR(totalRepaid)}</p></div>
        </div>
        <button onClick={openAdd} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white px-4 py-2`}>+ Add Entry</button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-zinc-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-700 text-xs text-zinc-500 uppercase tracking-wider">
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Contributor</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-right">Repaid</th>
              <th className="px-4 py-3 text-right">Outstanding</th>
              <th className="px-4 py-3 text-right">Rate</th>
              <th className="px-4 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {rows.length === 0 ? <EmptyRow cols={8} msg="No capital infusions yet." /> : rows.map((r) => {
              const outstanding = r.contributor_type === 'loan' ? Number(r.amount) - Number(r.repaid_amount) : null
              return (
                <tr key={r.id} className="hover:bg-zinc-800/40">
                  <td className="px-4 py-3 text-zinc-400 text-xs">{r.date}</td>
                  <td className="px-4 py-3 text-zinc-100">{r.contributor_name}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.contributor_type === 'partner' ? 'bg-blue-900 text-blue-300' : 'bg-yellow-900 text-yellow-300'}`}>
                      {r.contributor_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-100 font-medium">{fmtINR(r.amount)}</td>
                  <td className="px-4 py-3 text-right text-zinc-400">{r.contributor_type === 'loan' ? fmtINR(r.repaid_amount) : '—'}</td>
                  <td className="px-4 py-3 text-right">{outstanding !== null ? <span className={outstanding > 0 ? 'text-red-400' : 'text-green-400'}>{fmtINR(outstanding)}</span> : '—'}</td>
                  <td className="px-4 py-3 text-right text-zinc-400">{r.interest_rate ? `${(r.interest_rate * 100).toFixed(1)}%` : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEdit(r)} className={`${btn} bg-zinc-700 hover:bg-zinc-600 text-zinc-200`}>Edit</button>
                      <DeleteBtn onDelete={() => del(r.id)} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {show && (
        <Modal title={editing ? 'Update Entry' : 'Add Capital / Loan'} onClose={() => setShow(false)}>
          <form onSubmit={save} className="space-y-3">
            {!editing && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Contributor Name *</label>
                    <input className={inp} required value={form.contributor_name} onChange={f('contributor_name')} placeholder="Name" />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Type *</label>
                    <select className={sel} value={form.contributor_type} onChange={f('contributor_type')}>
                      <option value="partner">Partner</option>
                      <option value="loan">Loan</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Amount (₹) *</label>
                    <input className={inp} type="number" step="0.01" required value={form.amount} onChange={f('amount')} />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Date *</label>
                    <input className={inp} type="date" required value={form.date} onChange={f('date')} />
                  </div>
                </div>
                {form.contributor_type === 'loan' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">Annual Interest Rate (%)</label>
                      <input className={inp} type="number" step="0.01" value={form.interest_rate} onChange={f('interest_rate')} placeholder="e.g. 18" />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">Repayment Due</label>
                      <input className={inp} type="date" value={form.repayment_due} onChange={f('repayment_due')} />
                    </div>
                  </div>
                )}
              </>
            )}
            {(editing && editing.contributor_type === 'loan') && (
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Amount Repaid So Far (₹)</label>
                <input className={inp} type="number" step="0.01" value={form.repaid_amount} onChange={f('repaid_amount')} />
              </div>
            )}
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Note</label>
              <input className={inp} value={form.note} onChange={f('note')} placeholder="Optional note" />
            </div>
            {err && <p className="text-sm text-red-400">{err}</p>}
            <button type="submit" disabled={saving} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white w-full py-2 disabled:opacity-40`}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add'}
            </button>
          </form>
        </Modal>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Wallet tab (manual entries only)
// ---------------------------------------------------------------------------

const blankWT = { wallet: 'cashfree', type: 'recharge', amount: '', date: '', note: '' }

function WalletTab() {
  const [rows, setRows]     = useState([])
  const [show, setShow]     = useState(false)
  const [form, setForm]     = useState(blankWT)
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)

  const load = () => fetch('/api/wallet-transactions').then((r) => r.json()).then((d) => Array.isArray(d) && setRows(d))
  useEffect(() => { load() }, [])

  const save = async (e) => {
    e.preventDefault(); setSaving(true); setErr(null)
    const res  = await fetch('/api/wallet-transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const data = await res.json()
    if (!res.ok) { setErr(data.error || 'Failed'); setSaving(false); return }
    setShow(false); setForm(blankWT); load(); setSaving(false)
  }

  const del = async (id) => {
    if (!confirm('Delete this entry?')) return
    const res  = await fetch('/api/wallet-transactions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    const data = await res.json()
    if (!res.ok) { alert(data.error); return }
    load()
  }

  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  const typeColor = (t) => ({ recharge: 'text-green-400', withdrawal: 'text-red-400', service_fee: 'text-yellow-400', sourcing: 'text-blue-400' }[t] || 'text-zinc-400')

  return (
    <>
      <div className="flex justify-end mb-4">
        <button onClick={() => { setShow(true); setErr(null) }} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white px-4 py-2`}>+ Manual Entry</button>
      </div>
      <p className="text-xs text-zinc-500 mb-3">vFulfill-imported entries are shown here for reference but can only be changed by re-running the vFulfill import.</p>
      <div className="overflow-x-auto rounded-xl border border-zinc-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-700 text-xs text-zinc-500 uppercase tracking-wider">
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Wallet</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-left">Note</th>
              <th className="px-4 py-3 text-left">Source</th>
              <th className="px-4 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {rows.length === 0 ? <EmptyRow cols={7} msg="No wallet transactions yet." /> : rows.map((r) => (
              <tr key={r.id} className="hover:bg-zinc-800/40">
                <td className="px-4 py-3 text-zinc-400 text-xs">{r.date}</td>
                <td className="px-4 py-3 text-zinc-100 capitalize">{r.wallet}</td>
                <td className={`px-4 py-3 capitalize font-medium ${typeColor(r.type)}`}>{r.type.replace('_', ' ')}</td>
                <td className="px-4 py-3 text-right text-zinc-100">{fmtINR(r.amount)}</td>
                <td className="px-4 py-3 text-zinc-400 text-xs max-w-xs truncate">{r.note || '—'}</td>
                <td className="px-4 py-3 text-xs text-zinc-500">{r.vf_transaction_id ? 'vFulfill' : 'Manual'}</td>
                <td className="px-4 py-3 text-right">
                  {!r.vf_transaction_id && <DeleteBtn onDelete={() => del(r.id)} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {show && (
        <Modal title="Manual Wallet Entry" onClose={() => setShow(false)}>
          <form onSubmit={save} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Wallet *</label>
                <input className={inp} required value={form.wallet} onChange={f('wallet')} placeholder="cashfree / vfulfill" />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Type *</label>
                <select className={sel} value={form.type} onChange={f('type')}>
                  <option value="recharge">Recharge</option>
                  <option value="withdrawal">Withdrawal</option>
                  <option value="service_fee">Service Fee</option>
                  <option value="sourcing">Sourcing</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Amount (₹) *</label>
                <input className={inp} type="number" step="0.01" required value={form.amount} onChange={f('amount')} />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Date *</label>
                <input className={inp} type="date" required value={form.date} onChange={f('date')} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Note</label>
              <input className={inp} value={form.note} onChange={f('note')} placeholder="Optional note" />
            </div>
            {err && <p className="text-sm text-red-400">{err}</p>}
            <button type="submit" disabled={saving} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white w-full py-2 disabled:opacity-40`}>
              {saving ? 'Saving…' : 'Add'}
            </button>
          </form>
        </Modal>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Page shell with tabs
// ---------------------------------------------------------------------------

const TAB_COMPONENTS = {
  'Fixed Costs':     FixedCostsTab,
  'Marketing Spend': MarketingSpendTab,
  'Capital & Loans': CapitalTab,
  'Wallet':          WalletTab,
}

export default function DataPage() {
  const [active, setActive] = useState('Fixed Costs')
  const TabComponent = TAB_COMPONENTS[active]

  return (
    <div>
      <PageHeader
        title="Data"
        subtitle="Fixed costs, marketing spend, capital infusions, and wallet entries"
      />

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-zinc-700 mb-6">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            className={`px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
              active === tab
                ? 'border-blue-500 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <TabComponent />
    </div>
  )
}
