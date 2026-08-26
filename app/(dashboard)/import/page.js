'use client'

import { useRef, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import { addMonths, currentMonth, monthRange } from '@/lib/dates'

function monthBounds(offset = 0) {
  return monthRange(addMonths(currentMonth(), offset))
}

function ShopifySyncCard() {
  const { from: defaultFrom, to: defaultTo } = monthBounds()
  const [from, setFrom]     = useState(defaultFrom)
  const [to, setTo]         = useState(defaultTo)
  const [syncing, setSyncing] = useState(false)
  const [result, setResult]   = useState(null)
  const [err, setErr]         = useState(null)

  const handleSync = async () => {
    setSyncing(true)
    setResult(null)
    setErr(null)
    try {
      const res  = await fetch('/api/sync/shopify/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error || 'Sync failed'); return }
      setResult(data)
    } catch (e) {
      setErr(e.message)
    } finally {
      setSyncing(false)
    }
  }

  const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500'

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 flex flex-col gap-4 md:col-span-2">
      <div>
        <p className="text-base font-semibold text-slate-100">Sync Shopify Orders via API</p>
        <p className="text-sm text-slate-400 mt-0.5">Pulls paid + fulfilled orders directly from the Shopify Admin API — no CSV needed.</p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-400">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} style={{ width: '160px' }} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-400">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} style={{ width: '160px' }} />
        </div>
        <button
          onClick={handleSync}
          disabled={syncing || !from || !to}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {syncing ? 'Syncing…' : 'Sync from Shopify'}
        </button>
      </div>

      {err && (
        <div className="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
          {err}
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-green-800 bg-green-950/40 px-4 py-3 text-sm text-green-300 space-y-1">
          <p>Fetched from Shopify: <strong>{result.fetched}</strong></p>
          {result.inserted !== undefined && <p>Inserted: <strong>{result.inserted}</strong></p>}
          {result.updated  !== undefined && <p>Updated: <strong>{result.updated}</strong></p>}
          {result.line_items_created !== undefined && <p>Line items: <strong>{result.line_items_created}</strong></p>}
          {result.message && <p className="text-slate-400">{result.message}</p>}
          {result.warnings?.map((w, i) => <p key={i} className="text-yellow-400">⚠ {w}</p>)}
          {result.errors?.length > 0 && result.errors.map((e, i) => (
            <p key={i} className="text-red-400">Error: {JSON.stringify(e)}</p>
          ))}
        </div>
      )}
    </div>
  )
}

function UploadCard({ title, subtitle, endpoint, onDone }) {
  const inputRef = useRef(null)
  const [file, setFile]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState(null)
  const [err, setErr]         = useState(null)

  const pick = () => inputRef.current?.click()

  const upload = async () => {
    if (!file) return
    setLoading(true)
    setResult(null)
    setErr(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res  = await fetch(endpoint, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { setErr(data.error || 'Upload failed'); return }
      setResult(data)
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      onDone?.()
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 flex flex-col gap-4">
      <div>
        <p className="text-base font-semibold text-slate-100">{title}</p>
        <p className="text-sm text-slate-400 mt-0.5">{subtitle}</p>
      </div>

      {/* Drop zone */}
      <button
        onClick={pick}
        className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-700 bg-slate-800/50 py-8 text-sm text-slate-400 transition hover:border-blue-500 hover:text-slate-200 hover:bg-slate-800"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        {file ? <span className="text-slate-200 font-medium">{file.name}</span> : <span>Click to select CSV</span>}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        aria-label={`Select CSV for ${title}`}
        onChange={(e) => { setFile(e.target.files[0] || null); setResult(null); setErr(null) }}
      />

      <button
        onClick={upload}
        disabled={!file || loading}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? 'Uploading…' : 'Upload'}
      </button>

      {err && (
        <div className="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
          {err}
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-green-800 bg-green-950/40 px-4 py-3 text-sm text-green-300 space-y-1">
          {result.inserted     !== undefined && <p>Inserted: <strong>{result.inserted}</strong></p>}
          {result.updated      !== undefined && <p>Updated: <strong>{result.updated}</strong></p>}
          {result.orders_affected !== undefined && <p>Orders affected: <strong>{result.orders_affected}</strong></p>}
          {result.cost_rows_inserted !== undefined && <p>Cost rows: <strong>{result.cost_rows_inserted}</strong></p>}
          {result.wallet_rows  !== undefined && <p>Wallet entries: <strong>{result.wallet_rows}</strong></p>}
          {result.shipments_read !== undefined && <p>Shipments read: <strong>{result.shipments_read}</strong></p>}
          {result.delivery_dates_updated !== undefined && <p>Delivery dates corrected: <strong>{result.delivery_dates_updated}</strong></p>}
          {result.status_updated !== undefined && <p>Statuses updated: <strong>{result.status_updated}</strong></p>}
          {result.ship_states_filled !== undefined && result.ship_states_filled > 0 && <p>Ship states filled: <strong>{result.ship_states_filled}</strong></p>}
          {result.unchanged !== undefined && <p className="text-slate-400">Already correct: {result.unchanged}</p>}
          {result.skipped_no_order !== undefined && result.skipped_no_order > 0 && <p className="text-yellow-400">Skipped, no matching order: {result.skipped_no_order}</p>}
          {result.skipped      !== undefined && <p className="text-slate-400">Skipped: {result.skipped}</p>}
          {result.declined_skipped !== undefined && <p className="text-slate-400">Declined skipped: {result.declined_skipped}</p>}
          {result.warnings?.map((w, i) => (
            <p key={i} className="text-yellow-400">⚠ {w}</p>
          ))}
          {result.errors?.length > 0 && result.errors.map((e, i) => (
            <p key={i} className="text-red-400">Error: {JSON.stringify(e)}</p>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ImportPage() {
  return (
    <div>
      <PageHeader
        title="Import Data"
        subtitle="Sync Shopify orders via API, or upload CSVs manually."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
        <ShopifySyncCard />
        <UploadCard
          title="Shopify Orders (CSV fallback)"
          subtitle="Export from Shopify Admin → Orders → Export all orders as CSV"
          endpoint="/api/import/shopify"
        />
        <UploadCard
          title="vFulfill Transactions"
          subtitle="Export from vFulfill → Wallet → Transaction Report as CSV. Brings in per-order fees and wallet movements."
          endpoint="/api/import/vfulfill"
        />
        <UploadCard
          title="vFulfill Shipments"
          subtitle="Export from vFulfill → Orders → Shipments as CSV. This is the only file with real delivery dates — it decides which month each order's revenue and GST land in."
          endpoint="/api/import/vf-shipments"
        />
      </div>
    </div>
  )
}
