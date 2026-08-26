'use client'

import { addMonths, fmtMonth } from '@/lib/dates'

// monthStr: YYYY-MM string
// onChange: (newMonthStr: string) => void
export default function MonthPicker({ monthStr, onChange }) {
  const prev = () => onChange(addMonths(monthStr, -1))
  const next = () => onChange(addMonths(monthStr, 1))

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={prev}
        className="rounded-lg border border-slate-700/80 p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200 transition-colors cursor-pointer"
        aria-label="Previous month"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 12L6 8l4-4" />
        </svg>
      </button>
      <span className="min-w-[110px] text-center text-sm font-medium text-slate-300 tabular-nums">
        {fmtMonth(monthStr)}
      </span>
      <button
        onClick={next}
        className="rounded-lg border border-slate-700/80 p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200 transition-colors cursor-pointer"
        aria-label="Next month"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 4l4 4-4 4" />
        </svg>
      </button>
    </div>
  )
}
