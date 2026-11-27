'use client'

import { ScanLine } from 'lucide-react'
import { createContext, useContext, useId, useState, type ReactNode } from 'react'

type Cursor = {
  index: number | null
  select: (index: number | null) => void
  hintId: string
}

const TimelineContext = createContext<Cursor | null>(null)

export function useTimeline() {
  const cursor = useContext(TimelineContext)
  if (!cursor) throw new Error('Sparkline requires a PerformanceTimeline')
  return cursor
}

export function PerformanceTimeline({ labels, hourly, children }: { labels: string[]; hourly: boolean; children: ReactNode }) {
  const [index, select] = useState<number | null>(null)
  const hintId = useId()
  const label = index === null ? null : labels[index]
  return (
    <TimelineContext.Provider value={{ index, select, hintId }}>
      <div className="glass rise" onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) select(null)
      }}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-2.5 sm:px-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <ScanLine aria-hidden className="size-4 text-revenue" />Performance timeline
          </h2>
          {labels.length > 0 && <span aria-hidden className="text-xs tabular-nums text-ink-2">
            {label ? `${hourly ? 'Hour' : 'Day'} · ${label}` : 'Scrub any chart'}
          </span>}
        </div>
        <p id={hintId} className="sr-only">Inspect the same {hourly ? 'hour' : 'day'} across all four charts. Use the arrow keys to move or Escape to clear.</p>
        <div className="grid grid-cols-2 lg:grid-cols-4">{children}</div>
      </div>
    </TimelineContext.Provider>
  )
}
