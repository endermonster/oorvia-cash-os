'use client'

import { useRef, useState } from 'react'

// importType: 'orders' | 'ad_spend' | 'cod_wallet' | 'products'
// onDone: (result: { inserted, total, errors }) => void
export default function ImportButton({ importType, onDone, label }) {
  const inputRef = useRef(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('type', importType)

    const res = await fetch('/api/import', { method: 'POST', body: formData })
    const data = await res.json()

    setLoading(false)
    setResult(data)
    if (onDone) onDone(data)

    // Reset file input
    e.target.value = ''
  }

  return (
    <div className="flex items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        onChange={handleFile}
        className="hidden"
        aria-label={label || 'Import CSV'}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2v9M4 7l4-4 4 4" />
          <path d="M2 13h12" />
        </svg>
        {loading ? 'Importing…' : (label || 'Import CSV')}
      </button>

      {result && (
        <span className={`text-xs ${result.errors?.length > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
          {result.error
            ? `Error: ${result.error}`
            : `Imported ${result.inserted} of ${result.total} rows${result.errors?.length ? ` (${result.errors.length} errors)` : ''}`
          }
        </span>
      )}
    </div>
  )
}
