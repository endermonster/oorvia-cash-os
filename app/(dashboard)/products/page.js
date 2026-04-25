'use client'

import { useEffect, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import { fmtINR } from '@/lib/pnl'

const inp = 'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500'
const btn = 'rounded-lg px-3 py-1.5 text-sm font-medium transition'

const blank = { sku: '', name: '', current_cogs: '', default_selling_price: '', hsn_code: '', gst_percentage: '18' }

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <p className="text-base font-semibold text-zinc-100">{title}</p>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l10 10M14 4L4 14"/></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function CogsHistoryPanel({ sku, onClose }) {
  const [history, setHistory] = useState([])
  const [form, setForm]       = useState({ cogs: '', effective_from: new Date().toISOString().slice(0, 10), note: '' })
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState(null)

  useEffect(() => {
    fetch(`/api/cogs-history?sku=${encodeURIComponent(sku)}`)
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setHistory(d))
  }, [sku])

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setErr(null)
    const res  = await fetch('/api/cogs-history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sku, ...form }) })
    const data = await res.json()
    if (!res.ok) { setErr(data.error); setSaving(false); return }
    setHistory((prev) => [data, ...prev])
    setForm({ cogs: '', effective_from: new Date().toISOString().slice(0, 10), note: '' })
    setSaving(false)
  }

  return (
    <Modal title={`COGS History — ${sku}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-3 mb-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">New COGS (₹)</label>
            <input className={inp} type="number" step="0.01" required value={form.cogs} onChange={(e) => setForm({ ...form, cogs: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Effective From</label>
            <input className={inp} type="date" required value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Note (optional)</label>
          <input className={inp} placeholder="e.g. Supplier price revision" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
        {err && <p className="text-sm text-red-400">{err}</p>}
        <button type="submit" disabled={saving} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white w-full py-2 disabled:opacity-40`}>
          {saving ? 'Saving…' : 'Add Entry (closes previous)'}
        </button>
      </form>

      {history.length === 0 ? (
        <p className="text-sm text-zinc-500 text-center py-4">No history yet.</p>
      ) : (
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {history.map((h) => (
            <div key={h.id} className="flex items-center justify-between rounded-lg bg-zinc-800 px-3 py-2 text-sm">
              <div>
                <span className="text-zinc-100 font-medium">{fmtINR(h.cogs)}</span>
                {h.note && <span className="text-zinc-500 ml-2 text-xs">{h.note}</span>}
              </div>
              <div className="text-zinc-500 text-xs text-right">
                {h.effective_from} → {h.effective_to ?? '∞'}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

export default function ProductsPage() {
  const [products, setProducts]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [showForm, setShowForm]     = useState(false)
  const [editing, setEditing]       = useState(null)
  const [form, setForm]             = useState(blank)
  const [saving, setSaving]         = useState(false)
  const [err, setErr]               = useState(null)
  const [historyFor, setHistoryFor] = useState(null)

  const load = async () => {
    setLoading(true)
    const res = await fetch('/api/products')
    const d   = await res.json()
    if (Array.isArray(d)) setProducts(d)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const openAdd  = () => { setForm(blank); setEditing(null); setErr(null); setShowForm(true) }
  const openEdit = (p) => {
    setForm({ sku: p.sku, name: p.name, current_cogs: p.current_cogs, default_selling_price: p.default_selling_price ?? '', hsn_code: p.hsn_code ?? '', gst_percentage: p.gst_percentage ?? 18 })
    setEditing(p)
    setErr(null)
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setErr(null)
    const method = editing ? 'PATCH' : 'POST'
    const res    = await fetch('/api/products', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const data   = await res.json()
    if (!res.ok) { setErr(data.error || 'Failed'); setSaving(false); return }
    setShowForm(false)
    load()
    setSaving(false)
  }

  const handleDelete = async (sku) => {
    if (!confirm(`Delete product ${sku}? This cannot be undone.`)) return
    await fetch('/api/products', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sku }) })
    load()
  }

  const f = (k) => (e) => setForm((prev) => ({ ...prev, [k]: e.target.value }))

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Product catalog and COGS history"
        actions={
          <button onClick={openAdd} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white px-4 py-2`}>
            + Add Product
          </button>
        }
      />

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : products.length === 0 ? (
        <p className="text-sm text-zinc-500">No products yet. Add one above.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-700 text-xs text-zinc-500 uppercase tracking-wider">
                <th className="px-4 py-3 text-left">SKU</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-right">Current COGS</th>
                <th className="px-4 py-3 text-right">Default Price</th>
                <th className="px-4 py-3 text-left">HSN</th>
                <th className="px-4 py-3 text-right">GST %</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {products.map((p) => (
                <tr key={p.sku} className="hover:bg-zinc-800/40 transition-colors">
                  <td className="px-4 py-3 font-mono text-zinc-300 text-xs">{p.sku}</td>
                  <td className="px-4 py-3 text-zinc-100">{p.name}</td>
                  <td className="px-4 py-3 text-right text-zinc-100 font-medium">{fmtINR(p.current_cogs)}</td>
                  <td className="px-4 py-3 text-right text-zinc-400">{p.default_selling_price ? fmtINR(p.default_selling_price) : '—'}</td>
                  <td className="px-4 py-3 text-zinc-400 font-mono text-xs">{p.hsn_code || '—'}</td>
                  <td className="px-4 py-3 text-right text-zinc-400">{p.gst_percentage}%</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setHistoryFor(p.sku)} className={`${btn} bg-zinc-700 hover:bg-zinc-600 text-zinc-200`}>History</button>
                      <button onClick={() => openEdit(p)}          className={`${btn} bg-zinc-700 hover:bg-zinc-600 text-zinc-200`}>Edit</button>
                      <button onClick={() => handleDelete(p.sku)}  className={`${btn} bg-red-900/60 hover:bg-red-800 text-red-300`}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <Modal title={editing ? `Edit — ${editing.sku}` : 'Add Product'} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">SKU *</label>
                <input className={inp} required value={form.sku} onChange={f('sku')} disabled={!!editing} placeholder="e.g. YB31" />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">GST %</label>
                <input className={inp} type="number" step="0.01" value={form.gst_percentage} onChange={f('gst_percentage')} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Name *</label>
              <input className={inp} required value={form.name} onChange={f('name')} placeholder="Product name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  {editing ? 'COGS — use History to change' : 'Opening COGS (₹)'}
                </label>
                <input className={inp} type="number" step="0.01" value={form.current_cogs} onChange={f('current_cogs')} disabled={!!editing} placeholder="0.00" />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Default Selling Price (₹)</label>
                <input className={inp} type="number" step="0.01" value={form.default_selling_price} onChange={f('default_selling_price')} placeholder="0.00" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">HSN Code</label>
              <input className={inp} value={form.hsn_code} onChange={f('hsn_code')} placeholder="e.g. 85176290" />
            </div>
            {err && <p className="text-sm text-red-400">{err}</p>}
            <button type="submit" disabled={saving} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white w-full py-2 disabled:opacity-40`}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Product'}
            </button>
          </form>
        </Modal>
      )}

      {historyFor && <CogsHistoryPanel sku={historyFor} onClose={() => { setHistoryFor(null); load() }} />}
    </div>
  )
}
