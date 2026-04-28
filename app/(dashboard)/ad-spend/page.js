'use client'

import { useEffect, useRef, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import MonthPicker from '@/components/shared/MonthPicker'
import ImportButton from '@/components/shared/ImportButton'
import { fmtINR } from '@/lib/pnl'

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500'

const defaultForm = {
  spend_date: new Date().toISOString().slice(0, 10),
  campaign: '',
  adset: '',
  spend: '',
  impressions: '',
  clicks: '',
  purchases: '',
  notes: '',
}

// ── Campaign Attribution Panel ────────────────────────────────────────────────

function CampaignAttributionPanel({ products }) {
  const [open, setCampaignOpen]   = useState(false)
  const [campaigns, setCampaigns] = useState(null) // null = not yet fetched
  const [saving, setSaving]       = useState(null)

  useEffect(() => {
    if (!open || campaigns !== null) return
    fetch('/api/campaign-sku-map')
      .then(r => r.json())
      .then(data => setCampaigns(Array.isArray(data) ? data : []))
  }, [open, campaigns])

  const handleSkuChange = async (campaign_id, campaign_name, sku) => {
    setSaving(campaign_id)
    if (sku) {
      await fetch('/api/campaign-sku-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id, sku, campaign_name }),
      })
    } else {
      await fetch('/api/campaign-sku-map', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id }),
      })
    }
    setCampaigns(prev => prev.map(c => c.campaign_id === campaign_id ? { ...c, sku: sku || null } : c))
    setSaving(null)
  }

  const autoLink = async () => {
    const skuSet = new Set(products.map(p => p.sku))
    const toLink = campaigns.filter(c => {
      if (c.sku) return false
      const prefix = (c.campaign_name || '').split(' - ')[0].trim()
      return skuSet.has(prefix)
    })
    for (const c of toLink) {
      const sku = c.campaign_name.split(' - ')[0].trim()
      await handleSkuChange(c.campaign_id, c.campaign_name, sku)
    }
  }

  const loaded        = campaigns !== null
  const unlinkedCount = loaded ? campaigns.filter(c => !c.sku).length : 0

  return (
    <div className="rounded-2xl border border-zinc-700 bg-zinc-900">
      <button
        onClick={() => setCampaignOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-100">Campaign Attribution</span>
          {!open && unlinkedCount > 0 && (
            <span className="rounded-full bg-yellow-900/60 px-2 py-0.5 text-xs text-yellow-300">
              {unlinkedCount} unlinked
            </span>
          )}
          {!open && loaded && unlinkedCount === 0 && campaigns.length > 0 && (
            <span className="rounded-full bg-green-900/60 px-2 py-0.5 text-xs text-green-400">all linked</span>
          )}
        </div>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" className={`text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-zinc-700 px-5 pb-5">
          <div className="flex items-center justify-between py-3">
            <p className="text-xs text-zinc-400">
              Link each Meta campaign to its SKU. Used to attribute ad spend in per-SKU net margin on the P&L page.
              <br />
              <span className="text-zinc-500">
                Naming convention: <span className="font-mono text-zinc-400">SKU - Campaign Type - V#</span>
                {' '}(e.g. <span className="font-mono text-zinc-400">YB31 - Conversion - V1</span>)
              </span>
            </p>
            <button
              onClick={autoLink}
              className="ml-4 shrink-0 rounded-lg border border-zinc-600 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition"
            >
              Auto-link by name
            </button>
          </div>

          {!loaded ? (
            <p className="text-sm text-zinc-500 py-4">Loading…</p>
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-zinc-500 py-4">No campaigns found. Sync from Meta first.</p>
          ) : (
            <div className="rounded-xl border border-zinc-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-700 text-xs text-zinc-500 uppercase tracking-wider">
                    <th className="px-4 py-3 text-left">Campaign</th>
                    <th className="px-4 py-3 text-right">All-time Spend</th>
                    <th className="px-4 py-3 text-left">Linked SKU</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {campaigns.map(c => (
                    <tr key={c.campaign_id} className="hover:bg-zinc-800/40">
                      <td className="px-4 py-3">
                        <p className="text-zinc-100">{c.campaign_name || '—'}</p>
                        <p className="text-zinc-600 font-mono text-xs">{c.campaign_id}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-300">{fmtINR(c.total_spend)}</td>
                      <td className="px-4 py-3">
                        <select
                          value={c.sku || ''}
                          disabled={saving === c.campaign_id}
                          onChange={e => handleSkuChange(c.campaign_id, c.campaign_name, e.target.value || null)}
                          className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40"
                        >
                          <option value="">— unlinked —</option>
                          {products.map(p => (
                            <option key={p.sku} value={p.sku}>{p.sku} — {p.name}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdSpendPage() {
  const [month, setMonth]           = useState(currentMonth)
  const [entries, setEntries]       = useState([])
  const [orders, setOrders]         = useState([])
  const [products, setProducts]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [showForm, setShowForm]     = useState(false)
  const [editingEntry, setEditingEntry] = useState(null)
  const [form, setForm]             = useState(defaultForm)
  const [saving, setSaving]         = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [syncing, setSyncing]       = useState(false)
  const [syncMsg, setSyncMsg]       = useState(null)

  const fetchData = async (m) => {
    setLoading(true)
    const [adsRes, ordersRes] = await Promise.all([
      fetch(`/api/ad-spend?month=${m}`),
      fetch(`/api/orders?month=${m}&status=delivered`),
    ])
    const [adsData, ordersData] = await Promise.all([adsRes.json(), ordersRes.json()])
    if (Array.isArray(adsData)) setEntries(adsData)
    if (Array.isArray(ordersData)) setOrders(ordersData)
    setLoading(false)
  }

  useEffect(() => {
    fetch('/api/products').then(r => r.json()).then(d => { if (Array.isArray(d)) setProducts(d) })
  }, [])

  useEffect(() => { fetchData(month) }, [month])

  const openAdd = () => { setForm(defaultForm); setEditingEntry(null); setShowForm(true) }
  const openEdit = (e) => {
    setForm({
      spend_date: e.spend_date,
      campaign: e.campaign || '',
      adset: e.adset || '',
      spend: e.spend,
      impressions: e.impressions || '',
      clicks: e.clicks || '',
      purchases: e.purchases || '',
      notes: e.notes || '',
    })
    setEditingEntry(e)
    setShowForm(true)
  }

  const handleSave = async (ev) => {
    ev.preventDefault()
    setSaving(true)
    const method  = editingEntry ? 'PATCH' : 'POST'
    const payload = { ...form, ...(editingEntry ? { id: editingEntry.id } : {}) }
    await fetch('/api/ad-spend', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    setShowForm(false)
    fetchData(month)
    setSaving(false)
  }

  const handleMetaSync = async () => {
    setSyncing(true)
    setSyncMsg(null)
    const [y, m] = month.split('-').map(Number)
    const from = `${y}-${String(m).padStart(2, '0')}-01`
    const to   = new Date(y, m, 0).toISOString().slice(0, 10)
    const res  = await fetch('/api/sync/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    })
    const data = await res.json()
    if (data.error) {
      setSyncMsg({ ok: false, text: data.error })
    } else {
      setSyncMsg({ ok: true, text: `Synced ${data.synced} campaign-day rows from Meta` })
      fetchData(month)
    }
    setSyncing(false)
  }

  const handleDelete = async (id) => {
    setDeletingId(id)
    await fetch('/api/ad-spend', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    fetchData(month)
    setDeletingId(null)
  }

  const totalSpend        = entries.reduce((s, e) => s + Number(e.spend || 0), 0)
  const deliveredRevenue  = orders.reduce((s, o) => s + Number(o.order_value || 0), 0)
  const roas              = totalSpend > 0 ? (deliveredRevenue / totalSpend).toFixed(2) : '—'
  const totalPurchases    = entries.reduce((s, e) => s + Number(e.purchases || 0), 0)
  const cpa               = totalPurchases > 0 ? (totalSpend / totalPurchases).toFixed(0) : '—'

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Ad Spend"
        subtitle="Meta ads daily spend log"
        actions={
          <>
            <MonthPicker monthStr={month} onChange={setMonth} />
            <button onClick={handleMetaSync} disabled={syncing} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
              {syncing ? 'Syncing…' : 'Sync from Meta'}
            </button>
            <ImportButton importType="ad_spend" onDone={() => fetchData(month)} />
            <button onClick={openAdd} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">
              + Add Spend
            </button>
          </>
        }
      />

      {syncMsg && (
        <p className={`text-sm px-3 py-2 rounded-lg ${syncMsg.ok ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}>
          {syncMsg.text}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard title="Total Ad Spend"     value={fmtINR(totalSpend)}                                    color="red"   />
        <StatCard title="Delivered Revenue"  value={fmtINR(deliveredRevenue)}                              color="green" />
        <StatCard title="Est. ROAS"          value={roas === '—' ? '—' : `${roas}×`}                      color={parseFloat(roas) >= 2 ? 'green' : 'red'} subtitle="revenue / spend" />
        <StatCard title="Avg. CPA"           value={cpa === '—' ? '—' : `₹${cpa}`}                       color="zinc"  subtitle="cost per purchase" />
      </div>

      {showForm && (
        <form onSubmit={handleSave} className="rounded-2xl border border-zinc-700 bg-zinc-900 p-5">
          <h3 className="text-sm font-semibold text-zinc-100 mb-3">{editingEntry ? 'Edit Entry' : 'Add Ad Spend'}</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { name: 'spend_date', label: 'Date', type: 'date', required: true },
              { name: 'spend', label: 'Spend ₹', type: 'number', placeholder: '0', required: true },
              { name: 'campaign', label: 'Campaign', placeholder: 'Optional' },
              { name: 'adset', label: 'Ad Set', placeholder: 'Optional' },
              { name: 'impressions', label: 'Impressions', type: 'number', placeholder: '0' },
              { name: 'clicks', label: 'Clicks', type: 'number', placeholder: '0' },
              { name: 'purchases', label: 'Purchases', type: 'number', placeholder: '0' },
              { name: 'notes', label: 'Notes', placeholder: 'Optional' },
            ].map(({ name, label, type = 'text', placeholder, required }) => (
              <div key={name}>
                <label className="block text-xs font-medium text-zinc-400 mb-1">{label}</label>
                <input
                  type={type}
                  value={form[name]}
                  onChange={(e) => setForm((p) => ({ ...p, [name]: e.target.value }))}
                  placeholder={placeholder}
                  required={required}
                  min={type === 'number' ? 0 : undefined}
                  step={type === 'number' ? (name === 'spend' ? '0.01' : '1') : undefined}
                  className={inputCls}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
              {saving ? 'Saving…' : editingEntry ? 'Save' : 'Add'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : (
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-800 text-xs font-semibold text-zinc-400 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Campaign</th>
                  <th className="px-4 py-3 text-left">Ad Set</th>
                  <th className="px-4 py-3 text-right">Spend</th>
                  <th className="px-4 py-3 text-right">Impressions</th>
                  <th className="px-4 py-3 text-right">Clicks</th>
                  <th className="px-4 py-3 text-right">Purchases</th>
                  <th className="px-4 py-3 text-right">CPL</th>
                  <th className="px-4 py-3 text-right">CPA</th>
                  <th className="px-4 py-3 w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {entries.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-zinc-500">No ad spend entries this month.</td></tr>
                ) : entries.map((e) => {
                  const cpl      = e.clicks > 0    ? (e.spend / e.clicks).toFixed(2)    : '—'
                  const entryCA  = e.purchases > 0 ? (e.spend / e.purchases).toFixed(0) : '—'
                  return (
                    <tr key={e.id} className="hover:bg-zinc-800/60">
                      <td className="px-4 py-3 text-zinc-300 text-xs whitespace-nowrap">{new Date(e.spend_date).toLocaleDateString('en-IN')}</td>
                      <td className="px-4 py-3 text-zinc-300 max-w-[120px] truncate">{e.campaign || '—'}</td>
                      <td className="px-4 py-3 text-zinc-400 max-w-[120px] truncate">{e.adset || '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold text-red-400">{fmtINR(e.spend)}</td>
                      <td className="px-4 py-3 text-right text-zinc-400">{e.impressions?.toLocaleString('en-IN') || '—'}</td>
                      <td className="px-4 py-3 text-right text-zinc-400">{e.clicks?.toLocaleString('en-IN') || '—'}</td>
                      <td className="px-4 py-3 text-right text-zinc-300">{e.purchases || '—'}</td>
                      <td className="px-4 py-3 text-right text-zinc-400">₹{cpl}</td>
                      <td className="px-4 py-3 text-right text-zinc-400">₹{entryCA}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => openEdit(e)} className="text-xs text-zinc-400 hover:text-zinc-100 px-1.5 py-1 rounded hover:bg-zinc-700">Edit</button>
                          <button onClick={() => handleDelete(e.id)} disabled={deletingId === e.id} className="text-xs text-red-400 hover:text-red-200 px-1.5 py-1 rounded hover:bg-zinc-700 disabled:opacity-40">
                            {deletingId === e.id ? '…' : 'Del'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CampaignAttributionPanel products={products} />
    </div>
  )
}
