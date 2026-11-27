'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { X } from 'lucide-react'

/**
 * Linked highlight on Home: hover anything that belongs to a store (its row, its map squares, its orders, its calls)
 * and that store is traced across the page while the rest steps back. Click or tap a store row or a map square to
 * pin it; again, the × or Esc releases it.
 *
 * Server-rendered parts opt in with attributes, so they stay server components:
 * - `data-s="kaiven"` (or several ids, space-separated): belongs to that store; gets `hl-on` / `hl-off`.
 * - `data-hl-for="all" | "<id>"`: one variant of a figure; only the one for the traced store (or "all") shows.
 * - `data-peek="<id>"`: the store switcher's link; outlined while its store is traced.
 * Client parts that re-render on their own (the map, the chart) read `useHighlight()` instead.
 */
let hover: string | null = null
let pinned: string | null = null
const listeners = new Set<() => void>()
const current = () => pinned ?? hover
const notify = () => listeners.forEach((l) => l())

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** The store being traced, or null. */
export function useHighlight(): string | null {
  return useSyncExternalStore(subscribe, current, () => null)
}

/** A figure that follows the highlight: the traced store's value, else VXP's. */
export function HighlightValue({ vxp, by }: { vxp: string; by: Record<string, string> }) {
  const id = useHighlight()
  return <>{id !== null && id in by ? by[id] : vxp}</>
}

function usePinned(): string | null {
  return useSyncExternalStore(subscribe, () => pinned, () => null)
}

function apply() {
  const id = current()
  const root = document.documentElement
  if (id) root.dataset.hl = id
  else delete root.dataset.hl
  document.querySelectorAll<HTMLElement>('[data-s]').forEach((el) => {
    const mine = id !== null && el.dataset.s!.split(' ').includes(id)
    el.classList.toggle('hl-on', mine)
    el.classList.toggle('hl-off', id !== null && !mine)
  })
  document.querySelectorAll<HTMLElement>('[data-hl-for]').forEach((el) => {
    el.hidden = el.dataset.hlFor !== (id ?? 'all')
  })
  document.querySelectorAll<HTMLElement>('[data-peek]').forEach((el) => el.classList.toggle('hl-peek', el.dataset.peek === id))
  notify()
}

const storeOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('[data-s]')?.dataset.s?.split(' ') ?? null : null)

export function LinkedHighlight() {
  useEffect(() => {
    let leave: ReturnType<typeof setTimeout> | undefined
    // Leaving a store waits a beat, so crossing the gap between two rows never flashes the whole page back.
    const setHover = (ids: string[] | null) => {
      clearTimeout(leave)
      // Something shared by several stores (a city with orders from two) does not pick one.
      const next = ids && ids.length === 1 ? ids[0] : null
      if (next === hover) return
      if (next) { hover = next; apply() } else leave = setTimeout(() => { hover = null; apply() }, 140)
    }
    const over = (e: PointerEvent) => { if (e.pointerType !== 'touch') setHover(storeOf(e.target)) }
    const focus = (e: FocusEvent) => setHover(storeOf(e.target))
    const click = (e: MouseEvent) => {
      const t = e.target as Element
      if (t.closest('a, button')) return // the store's link still opens its view
      const el = t.closest<HTMLElement>('.store-row[data-s], .map-sq[data-s]')
      const ids = el?.dataset.s?.split(' ')
      if (!ids || ids.length !== 1) return
      pinned = pinned === ids[0] ? null : ids[0]
      apply()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (pinned || hover)) { pinned = null; hover = null; apply(); return }
      const t = e.target as HTMLElement
      if ((e.key === 'Enter' || e.key === ' ') && t.matches('.store-row[data-s]')) {
        e.preventDefault()
        pinned = pinned === t.dataset.s ? null : t.dataset.s!
        apply()
      }
    }
    document.addEventListener('pointerover', over)
    document.addEventListener('focusin', focus)
    document.addEventListener('click', click)
    document.addEventListener('keydown', key)
    return () => {
      clearTimeout(leave)
      document.removeEventListener('pointerover', over)
      document.removeEventListener('focusin', focus)
      document.removeEventListener('click', click)
      document.removeEventListener('keydown', key)
      // Leaving Home: nothing stays traced.
      hover = null; pinned = null; apply()
    }
  }, [])
  return null
}

/** In the Stores header: how to use it, or which store is pinned with a way out. */
export function HighlightStatus({ names }: { names: Record<string, string> }) {
  const p = usePinned()
  if (!p) return <span className="hidden text-xs text-ink-4 lg:inline">Hover a store to trace it across the page · click to pin</span>
  return (
    <span className="inline-flex h-7 items-center gap-2 rounded-lg bg-lime/12 pl-2.5 pr-1 text-[0.8125rem] font-semibold text-lime">
      {names[p] ?? p} pinned
      <button type="button" aria-label="Stop tracing this store" onClick={() => { pinned = null; hover = null; apply() }}
        className="inline-flex size-5 items-center justify-center rounded-md hover:bg-lime/20">
        <X className="size-3" strokeWidth={2.6} aria-hidden />
      </button>
    </span>
  )
}
