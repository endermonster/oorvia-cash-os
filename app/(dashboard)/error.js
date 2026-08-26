'use client'

import { useEffect } from 'react'

export default function DashboardError({ error, reset }) {
  useEffect(() => {
    console.error('[cash-os] page error:', error)
  }, [error])

  return (
    <div className="mx-auto max-w-xl py-16">
      <div className="rounded-xl border border-red-900/60 bg-red-950/20 p-6">
        <div className="mb-3 flex items-center gap-2.5">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="#f87171" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="8" r="6.5" />
            <path d="M8 5v3.5M8 11h.01" />
          </svg>
          <h2 className="text-base font-semibold tracking-tight text-slate-100">
            This page could not load
          </h2>
        </div>

        <p className="text-sm text-slate-400">
          Something failed while fetching or computing this view. Your data has not been
          changed. Try again — if it keeps failing, the message below is what to go on.
        </p>

        <p className="mt-4 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 font-mono text-xs text-slate-400 break-words">
          {error?.message || 'Unknown error'}
          {error?.digest && <span className="block mt-1 text-slate-600">digest: {error.digest}</span>}
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={reset}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 cursor-pointer"
          >
            Try again
          </button>
          <a
            href="/pnl"
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100"
          >
            Back to P&amp;L
          </a>
        </div>
      </div>
    </div>
  )
}
