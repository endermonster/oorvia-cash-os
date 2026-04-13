'use client'

import { useEffect, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import MonthPicker from '@/components/shared/MonthPicker'
import { fmtINR } from '@/lib/pnl'

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500'

function MarginBadge({ pct }) {
  const color = pct >= 40 ? 'bg-green-900 text-green-300' : pct >= 20 ? 'bg-yellow-900 text-yellow-300' : 'bg-red-900 text-red-300'
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{pct.toFixed(1)}%</span>
}

const defaultProductForm = { name: '', sku: '', category: '', cogs: '', selling_price: '', weight_grams: '', gst_rate: '18' }

export default function ProductsPage() {
  const [month, setMonth] = useState(currentMonth)
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [form, setForm] = useState(defaultProductForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const fetch_ = async (m) => {
    setLoading(true)
    const res = await fetch(`/api/products?withMetrics=true&month=${m}`)
    const data = await res.json()
    if (Array.isArray(data)) setProducts(data)
    setLoading(false)
  }

  useEffect(() => { fetch_(month) }, [month])

  const openAdd = () => { setForm(defaultProductForm); setEditingProduct(null); setShowForm(true) }
  const openEdit = (p) => {
    setForm({ name: p.name, sku: p.sku, category: p.category || '', cogs: p.cogs, selling_price: p.selling_price, weight_grams: p.weight_grams || '', gst_rate: p.gst_rate ?? 18 })
    setEditingProduct(p)
    setShowForm(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const method = editingProduct ? 'PATCH' : 'POST'
    const payload = { ...form, ...(editingProduct ? { id: editingProduct.id } : {}) }
    const res = await fetch('/api/products', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed'); setSaving(false); return }
    setShowForm(false)
    fetch_(month)
    setSaving(false)
  }

  const handleDelete = async (id) => {
    if (!confirm('Archive this product?')) return
    await fetch('/api/products', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    fetch_(month)
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Products"
        subtitle="Per-product profitability"
        actions={
          <>
            <MonthPicker monthStr={month} onChange={setMonth} />
            <button onClick={openAdd} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">
              + Add Product
            </button>
          </>
        }
      />

      {loading ? <p className="text-sm text-zinc-400">Loading…</p> : (
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-800 text-xs font-semibold text-zinc-400 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Product</th>
                  <th className="px-4 py-3 text-left">SKU</th>
                  <th className="px-4 py-3 text-right">Units Sold</th>
                  <th className="px-4 py-3 text-right">Revenue</th>
                  <th className="px-4 py-3 text-right">COGS</th>
                  <th className="px-4 py-3 text-right">Gross Margin</th>
                  <th className="px-4 py-3 text-right">Margin %</th>
                  <th className="px-4 py-3 text-right">GST Rate</th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {products.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-500">No products yet.</td></tr>
                ) : products.map((p) => (
                  <tr key={p.id} className="hover:bg-zinc-800/60">
                    <td className="px-4 py-3 font-medium text-zinc-200">{p.name}</td>
                    <td className="px-4 py-3 text-zinc-400 font-mono text-xs">{p.sku}</td>
                    <td className="px-4 py-3 text-right text-zinc-300">{p.units_sold || 0}</td>
                    <td className="px-4 py-3 text-right text-zinc-200 font-semibold">{fmtINR(p.revenue || 0)}</td>
                    <td className="px-4 py-3 text-right text-zinc-400">{fmtINR(p.total_cogs || 0)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${(p.gross_margin || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {fmtINR(p.gross_margin || 0)}
                    </td>
                    <td className="px-4 py-3 text-right"><MarginBadge pct={p.margin_pct || 0} /></td>
                    <td className="px-4 py-3 text-right text-zinc-400 text-xs">{p.gst_rate ?? 18}%</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => openEdit(p)} className="text-xs text-zinc-400 hover:text-zinc-100 px-2 py-1 rounded hover:bg-zinc-700">Edit</button>
                        <button onClick={() => handleDelete(p.id)} className="text-xs text-red-400 hover:text-red-200 px-2 py-1 rounded hover:bg-zinc-700">Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-zinc-100">{editingProduct ? 'Edit Product' : 'Add Product'}</h2>
              <button onClick={() => setShowForm(false)} className="text-zinc-500 hover:text-zinc-200">
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="2" y1="2" x2="14" y2="14" /><line x1="14" y1="2" x2="2" y2="14" /></svg>
              </button>
            </div>
            <form onSubmit={handleSave} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                { name: 'name', label: 'Product Name', placeholder: 'e.g. Blue Ceramic Mug', required: true },
                { name: 'sku', label: 'SKU', placeholder: 'e.g. MUG-BLU-01', required: true },
                { name: 'category', label: 'Category', placeholder: 'Optional' },
                { name: 'cogs', label: 'COGS ₹', placeholder: '0', type: 'number' },
                { name: 'selling_price', label: 'Selling Price ₹', placeholder: '0', type: 'number' },
                { name: 'weight_grams', label: 'Weight (grams)', placeholder: 'Optional', type: 'number' },
              ].map(({ name, label, placeholder, type = 'text', required }) => (
                <div key={name}>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">{label}</label>
                  <input
                    type={type}
                    value={form[name]}
                    onChange={(e) => setForm((p) => ({ ...p, [name]: e.target.value }))}
                    placeholder={placeholder}
                    required={required}
                    min={type === 'number' ? 0 : undefined}
                    step={type === 'number' ? '0.01' : undefined}
                    className={inputCls}
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">GST Rate %</label>
                <select value={form.gst_rate} onChange={(e) => setForm((p) => ({ ...p, gst_rate: e.target.value }))} className={inputCls}>
                  {[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}
                </select>
              </div>
              {error && <p className="col-span-full text-sm text-red-400">{error}</p>}
              <div className="col-span-full flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700">Cancel</button>
                <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
                  {saving ? 'Saving…' : editingProduct ? 'Save' : 'Add Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
