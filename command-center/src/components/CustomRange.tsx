'use client'

import Form from 'next/form'
import { CalendarRange } from 'lucide-react'
import { useId, useRef } from 'react'

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/**
 * Home's Custom period: a pill that opens two date fields, submitted as ?period=custom&from=&to= (the store kept).
 * The popover sits in the top layer, so the period switch's scrolling pill cannot clip it; it opens under the pill.
 * `range`: the clamped range showing now, null when another period is on.
 */
export function CustomRange({ store, range, min, max, itemClass, onApply }: {
  store: string; range: { from: string; to: string } | null; min: string; max: string; itemClass: string
  /** Takes over the navigation (ViewSwitches), so a store clicked before the range lands keeps it. */
  onApply?: (from: string, to: string) => void
}) {
  const id = useId()
  const pop = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const on = range !== null

  function place() {
    const b = btn.current?.getBoundingClientRect()
    const p = pop.current
    if (!b || !p) return
    const w = Math.min(320, window.innerWidth - 16)
    p.style.width = `${w}px`
    p.style.left = `${Math.max(8, Math.min(b.right - w, window.innerWidth - w - 8))}px`
    // Below the pill, or above it when a short window (a zoomed laptop) leaves too little room under it;
    // either way capped to the room there, scrolling inside, so Apply is always reachable.
    const below = window.innerHeight - b.bottom - 16
    const above = b.top - 16
    const up = below < 220 && above > below
    p.style.top = up ? 'auto' : `${b.bottom + 8}px`
    p.style.bottom = up ? `${window.innerHeight - b.top + 8}px` : 'auto'
    p.style.maxHeight = `${Math.max(120, up ? above : below)}px`
  }

  return (
    <>
      <button ref={btn} type="button" popoverTarget={id} onClick={place} aria-current={on ? 'true' : undefined}
        className={`${itemClass} gap-1.5 ${on ? 'glass-pill-on font-semibold text-ink' : 'text-ink-2 hover:text-ink'}`}>
        <CalendarRange className="size-3.5 shrink-0" aria-hidden />
        {on ? (range.from === range.to ? fmt(range.from) : `${fmt(range.from)} – ${fmt(range.to)}`) : 'Custom'}
      </button>
      <div ref={pop} id={id} popover="auto" aria-label="Custom range"
        className="fixed inset-auto m-0 overflow-y-auto rounded-xl border border-line-strong bg-raised-2/95 p-4 text-sm text-ink shadow-[0_24px_50px_-20px_rgb(0_0_0/0.75)] backdrop-blur-md">
        <Form key={range ? `${range.from}|${range.to}` : 'none'} action="/" className="space-y-3" onSubmit={(e) => {
          pop.current?.hidePopover()
          if (!onApply) return
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          onApply(String(f.get('from')), String(f.get('to')))
        }}>
          {store !== 'all' && <input type="hidden" name="store" value={store} />}
          <input type="hidden" name="period" value="custom" />
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="label block">From</span>
              <input type="date" name="from" required min={min} max={max} defaultValue={range?.from ?? ''}
                className="h-9 w-full rounded-lg bg-ground/60 px-2 text-ink ring-1 ring-line-strong [color-scheme:dark] focus:outline-none focus:ring-revenue" />
            </label>
            <label className="space-y-1">
              <span className="label block">To</span>
              <input type="date" name="to" required min={min} max={max} defaultValue={range?.to ?? max}
                className="h-9 w-full rounded-lg bg-ground/60 px-2 text-ink ring-1 ring-line-strong [color-scheme:dark] focus:outline-none focus:ring-revenue" />
            </label>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-ink-3">Up to 365 days back</span>
            <button type="submit" className="glass-pill-on h-9 rounded-lg px-4 font-semibold text-ink">Apply</button>
          </div>
        </Form>
      </div>
    </>
  )
}
