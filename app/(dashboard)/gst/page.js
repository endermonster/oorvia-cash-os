'use client'

import { useEffect, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import MonthPicker from '@/components/shared/MonthPicker'
const fmtINR = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n)

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500'

const GST_RATES = [0, 5, 12, 18, 28]

const MANUAL_SOURCES = [
  'Shopify Subscription (RCM)',
  'vFulfill Membership',
  'vFulfill Platform Fee',
  'Domain / Hosting',
  'Software SaaS (RCM)',
  'Other',
]

const defaultEntryForm = {
  type: 'itc',
  source: MANUAL_SOURCES[0],
  description: '',
  taxable_amount: '',
  gst_rate: '18',
  notes: '',
}

function SectionCard({ title, badge, badgeColor = 'zinc', children }) {
  const badgeColors = {
    green: 'bg-green-900 text-green-300',
    red: 'bg-red-900 text-red-300',
    blue: 'bg-blue-900 text-blue-300',
    zinc: 'bg-zinc-700 text-zinc-300',
  }
  return (
    <div className="rounded-2xl border border-zinc-700 bg-zinc-900 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        {badge !== undefined && (
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${badgeColors[badgeColor]}`}>
            {fmtINR(badge)}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

export default function GSTPage() {
  const [month, setMonth] = useState(currentMonth)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showEntryForm, setShowEntryForm] = useState(false)
  const [entryForm, setEntryForm] = useState(defaultEntryForm)
  const [savingEntry, setSavingEntry] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  const fetchGST = async (m) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/gst?month=${m}`)
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Failed to load'); setLoading(false); return }
      setData(json)
      setLoading(false)
    } catch (e) {
      setError('Failed to load GST data'); setLoading(false)
    }
  }

  useEffect(() => { fetchGST(month) }, [month])

  const handleAddEntry = async (e) => {
    e.preventDefault()
    setSavingEntry(true)
    const [y, m_] = month.split('-').map(Number)
    const entry_month = `${y}-${String(m_).padStart(2, '0')}-01`
    const res = await fetch('/api/gst/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...entryForm, entry_month }),
    })
    if (res.ok) {
      setShowEntryForm(false)
      setEntryForm(defaultEntryForm)
      fetchGST(month)
    }
    setSavingEntry(false)
  }

  const handleDeleteEntry = async (id) => {
    setDeletingId(id)
    await fetch('/api/gst/entries', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    fetchGST(month)
    setDeletingId(null)
  }

  // Derived
  const otcTotal = data?.otc?.total || 0
  const itcTotal = data?.itc?.total || 0
  const netLiability = data?.net_liability || 0
  const isPayable = netLiability > 0

  // ITC breakdown rows
  const itcBreakdown = data ? [
    { label: '3PL Charges (delivery, packing, inbound, COD, RTO)', amount: data.itc.from_3pl, note: '18% on charges paid' },
    { label: 'Checkout Service Fees', amount: data.itc.from_checkout, note: '18/118 of checkout fee (GST-inclusive)' },
    { label: 'Payment Gateway Fees (Prepaid)', amount: data.itc.from_payment_gw, note: '18% on PG fees' },
    { label: 'Meta Ads (IGST)', amount: data.itc.from_meta_ads, note: `18% on ${fmtINR(data.ad_spend_total)} ad spend` },
    { label: 'Manual Entries (Shopify RCM, etc.)', amount: data.itc.from_manual, note: 'From entries below' },
  ] : []

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="GST Tracker"
        subtitle="Monthly output tax collected (OTC) vs input tax credit (ITC)"
        actions={
          <>
            <MonthPicker monthStr={month} onChange={setMonth} />
            <button
              onClick={() => setShowEntryForm((s) => !s)}
              className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              + Manual Entry
            </button>
          </>
        }
      />

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              title="Output Tax (OTC)"
              value={fmtINR(otcTotal)}
              subtitle={`GST collected on ${data?.order_count || 0} delivered orders`}
              color="blue"
            />
            <StatCard
              title="Input Tax Credit (ITC)"
              value={fmtINR(itcTotal)}
              subtitle="3PL + ads + checkout + PG + manual"
              color="green"
            />
            <StatCard
              title={isPayable ? 'Net GST Payable' : 'Net ITC Credit'}
              value={fmtINR(Math.abs(netLiability))}
              subtitle={isPayable ? 'OTC − ITC — pay to government' : 'ITC > OTC — carries forward'}
              color={isPayable ? 'red' : 'green'}
            />
          </div>

          {/* GST Summary bar */}
          <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-zinc-100">GST Position</h3>
              <span className={`text-xs font-bold px-3 py-1 rounded-full ${isPayable ? 'bg-red-900 text-red-300' : 'bg-green-900 text-green-300'}`}>
                {isPayable ? `₹${Math.abs(netLiability).toLocaleString('en-IN')} PAYABLE` : `₹${Math.abs(netLiability).toLocaleString('en-IN')} CREDIT`}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <div className="flex-1">
                <div className="flex justify-between mb-1">
                  <span className="text-zinc-400">OTC (collected)</span>
                  <span className="text-blue-400 font-semibold">{fmtINR(otcTotal)}</span>
                </div>
                <div className="h-3 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full rounded-full bg-blue-600" style={{ width: '100%' }} />
                </div>
              </div>
              <span className="text-zinc-600 shrink-0">−</span>
              <div className="flex-1">
                <div className="flex justify-between mb-1">
                  <span className="text-zinc-400">ITC (claimable)</span>
                  <span className="text-green-400 font-semibold">{fmtINR(itcTotal)}</span>
                </div>
                <div className="h-3 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-600"
                    style={{ width: `${Math.min(100, otcTotal > 0 ? (itcTotal / otcTotal) * 100 : 100)}%` }}
                  />
                </div>
              </div>
              <span className="text-zinc-600 shrink-0">=</span>
              <div className="shrink-0 text-right">
                <p className="text-zinc-400 mb-1">Net</p>
                <p className={`font-bold text-base ${isPayable ? 'text-red-400' : 'text-green-400'}`}>
                  {isPayable ? '+' : '−'}{fmtINR(Math.abs(netLiability))}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* ITC Breakdown */}
            <SectionCard title="ITC Breakdown — Input Tax Credit" badge={itcTotal} badgeColor="green">
              <div className="divide-y divide-zinc-800">
                {itcBreakdown.map(({ label, amount, note }) => (
                  <div key={label} className="flex items-start justify-between px-5 py-3">
                    <div className="min-w-0 flex-1 pr-4">
                      <p className="text-sm text-zinc-200">{label}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{note}</p>
                    </div>
                    <span className={`text-sm font-semibold shrink-0 ${amount > 0 ? 'text-green-400' : 'text-zinc-600'}`}>
                      {fmtINR(amount)}
                    </span>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* OTC Breakdown */}
            <SectionCard title="OTC Breakdown — Output Tax Collected" badge={otcTotal} badgeColor="blue">
              {/* IGST / CGST / SGST summary */}
              <div className="grid grid-cols-3 divide-x divide-zinc-800 border-b border-zinc-800 text-xs">
                <div className="px-4 py-2.5 text-center">
                  <p className="text-zinc-500 mb-0.5">IGST (inter-state)</p>
                  <p className="text-blue-400 font-semibold">{fmtINR(data.otc.igst)}</p>
                </div>
                <div className="px-4 py-2.5 text-center">
                  <p className="text-zinc-500 mb-0.5">CGST (MH, 9%)</p>
                  <p className="text-blue-400 font-semibold">{fmtINR(data.otc.cgst)}</p>
                </div>
                <div className="px-4 py-2.5 text-center">
                  <p className="text-zinc-500 mb-0.5">SGST (MH, 9%)</p>
                  <p className="text-blue-400 font-semibold">{fmtINR(data.otc.sgst)}</p>
                </div>
              </div>
              {data?.otc?.orders?.length === 0 ? (
                <p className="px-5 py-8 text-sm text-zinc-500 text-center">No delivered orders this month.</p>
              ) : (
                <div className="overflow-y-auto max-h-64">
                  <table className="min-w-full text-xs">
                    <thead className="bg-zinc-800 text-zinc-500 uppercase tracking-wide sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left">Order</th>
                        <th className="px-4 py-2 text-left">State</th>
                        <th className="px-4 py-2 text-right">Sale</th>
                        <th className="px-4 py-2 text-right">Tax Type</th>
                        <th className="px-4 py-2 text-right">GST</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {data.otc.orders.map((o) => {
                        const isIntra = o.cgst > 0
                        return (
                          <tr key={o.order_id} className="hover:bg-zinc-800/40">
                            <td className="px-4 py-2 text-zinc-400">{o.shopify_order_name || String(o.order_id ?? '').slice(-6) || '—'}</td>
                            <td className="px-4 py-2 text-zinc-300 max-w-[80px] truncate">{o.ship_state || '—'}</td>
                            <td className="px-4 py-2 text-right text-zinc-300">{fmtINR(o.order_value)}</td>
                            <td className="px-4 py-2 text-right text-zinc-500">
                              {isIntra ? 'CGST+SGST 9%+9%' : 'IGST 18%'}
                            </td>
                            <td className="px-4 py-2 text-right text-blue-400 font-semibold">{fmtINR(o.gst_amount)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot className="bg-zinc-800/60 border-t border-zinc-700">
                      <tr>
                        <td colSpan={4} className="px-4 py-2 text-xs text-zinc-400 font-semibold">Total OTC</td>
                        <td className="px-4 py-2 text-right text-blue-400 font-bold">{fmtINR(data.otc.from_orders)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </SectionCard>
          </div>

          {/* Manual Entry Form */}
          {showEntryForm && (
            <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-5">
              <h3 className="text-sm font-semibold text-zinc-100 mb-4">Add Manual GST Entry</h3>
              <form onSubmit={handleAddEntry}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Type</label>
                    <select value={entryForm.type} onChange={(e) => setEntryForm((p) => ({ ...p, type: e.target.value }))} className={inputCls}>
                      <option value="itc">ITC (Input)</option>
                      <option value="otc">OTC (Output)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Source</label>
                    <select value={entryForm.source} onChange={(e) => setEntryForm((p) => ({ ...p, source: e.target.value }))} className={inputCls}>
                      {MANUAL_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Taxable Amount ₹</label>
                    <input
                      type="number"
                      value={entryForm.taxable_amount}
                      onChange={(e) => setEntryForm((p) => ({ ...p, taxable_amount: e.target.value }))}
                      placeholder="0"
                      min="0"
                      step="0.01"
                      required
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">GST Rate %</label>
                    <select value={entryForm.gst_rate} onChange={(e) => setEntryForm((p) => ({ ...p, gst_rate: e.target.value }))} className={inputCls}>
                      {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Description</label>
                    <input
                      type="text"
                      value={entryForm.description}
                      onChange={(e) => setEntryForm((p) => ({ ...p, description: e.target.value }))}
                      placeholder="e.g. Shopify subscription May 2026"
                      className={inputCls}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Notes</label>
                    <input
                      type="text"
                      value={entryForm.notes}
                      onChange={(e) => setEntryForm((p) => ({ ...p, notes: e.target.value }))}
                      placeholder="Optional"
                      className={inputCls}
                    />
                  </div>
                </div>
                {/* Preview */}
                {entryForm.taxable_amount && (
                  <p className="text-xs text-zinc-400 mb-3">
                    GST amount:{' '}
                    <span className={entryForm.type === 'itc' ? 'text-green-400 font-semibold' : 'text-blue-400 font-semibold'}>
                      {fmtINR(parseFloat(entryForm.taxable_amount || 0) * parseFloat(entryForm.gst_rate) / 100)}
                    </span>
                  </p>
                )}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowEntryForm(false)} className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700">
                    Cancel
                  </button>
                  <button type="submit" disabled={savingEntry} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
                    {savingEntry ? 'Saving…' : 'Add Entry'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Manual entries list */}
          {data?.manual_entries?.length > 0 && (
            <SectionCard title="Manual Entries">
              <div className="divide-y divide-zinc-800">
                {data.manual_entries.map((e) => (
                  <div key={e.id} className="flex items-center justify-between px-5 py-3 gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${e.type === 'itc' ? 'bg-green-900 text-green-300' : 'bg-blue-900 text-blue-300'}`}>
                          {e.type}
                        </span>
                        <span className="text-sm text-zinc-200">{e.source}</span>
                      </div>
                      {e.description && <p className="text-xs text-zinc-500 mt-0.5">{e.description}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-zinc-500">
                        Taxable: {fmtINR(e.taxable_amount)} @ {e.gst_rate}%
                      </p>
                      <p className={`text-sm font-semibold ${e.type === 'itc' ? 'text-green-400' : 'text-blue-400'}`}>
                        GST: {fmtINR(e.gst_amount)}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteEntry(e.id)}
                      disabled={deletingId === e.id}
                      className="shrink-0 text-red-400 hover:text-red-200 text-xs px-2 py-1 rounded hover:bg-zinc-700 disabled:opacity-40"
                    >
                      {deletingId === e.id ? '…' : 'Delete'}
                    </button>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Footnote */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4 text-xs text-zinc-500 space-y-1">
            <p className="font-semibold text-zinc-400">GST Computation Notes</p>
            <p>• <strong>OTC</strong> is calculated only on <em>delivered</em> orders using product GST rate (default 18%). Formula: selling price × rate ÷ (100 + rate) — assumes GST-inclusive pricing.</p>
            <p>• <strong>3PL ITC</strong>: 18% on all 3PL charges including RTO return fees (vFulfill is GST-registered, charges CGST+SGST or IGST).</p>
            <p>• <strong>Checkout ITC</strong>: Checkout fee is 2% + 18% GST; ITC = fee × 18/118.</p>
            <p>• <strong>Payment GW ITC</strong>: 18% on payment gateway fee (prepaid orders only).</p>
            <p>• <strong>Meta Ads ITC</strong>: 18% IGST on ad spend (import of service).</p>
            <p>• Manual entries are for Shopify RCM, vFulfill membership, and any other taxed expense not auto-captured above.</p>
            <p>• This is a <strong>summary tool</strong>, not a substitute for professional GST filing. Verify with your CA before filing GSTR-3B.</p>
          </div>
        </>
      )}
    </div>
  )
}
