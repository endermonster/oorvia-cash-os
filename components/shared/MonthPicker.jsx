'use client'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// monthStr: YYYY-MM string
// onChange: (newMonthStr: string) => void
export default function MonthPicker({ monthStr, onChange }) {
  const [year, month] = monthStr.split('-').map(Number)

  const prev = () => {
    const d = new Date(year, month - 2, 1)
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const next = () => {
    const d = new Date(year, month, 1)
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

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
        {MONTHS[month - 1]} {year}
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
