'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { startTransition, useOptimistic, type ReactNode } from 'react'
import type { StoreId } from '@/lib/types'
import { viewKey } from '@/lib/view-key'
import { StoreDot } from './bits'
import { CustomRange } from './CustomRange'

export type SwitchItem = { id: string; label: string; dot?: StoreId }
/** `from`/`to`: a custom range just applied and still loading (Home's switch only). */
type View = { store: string; period: string; from?: string; to?: string }

/** Home with a custom range, written as lib/nav's href writes it (that module stays out of the client bundle). */
function customHref(store: string, from: string, to: string) {
  const q = new URLSearchParams()
  if (store !== 'all') q.set('store', store)
  q.set('period', 'custom'); q.set('from', from); q.set('to', to)
  return `/?${q}`
}
type Group = { label: string; items: SwitchItem[]; className: string; itemClass: string }

/** From the first switch on, panels show new figures at once instead of rising in (globals.css). */
function markNavigated() {
  document.documentElement.dataset.navigated = ''
}

/**
 * The store and period switches, which move to the clicked choice at once instead of when the new page arrives.
 * One optimistic view for both, so a second click before the first lands keeps the first (Oorvia, then Today, shows
 * Oorvia today). It holds only while the navigation runs; then the URL-backed view shows again (also after Back, or
 * a navigation that fails). While pending, `data-pending` dims the page content (globals.css). `hrefs` holds every
 * store with every period (keyed by viewKey), built on the server with lib/nav's href.
 */
export function ViewSwitches({ store, period, hrefs, stores, periods, custom }: {
  store: string; period: string; hrefs: Record<string, string>; stores: Group; periods: Group | null
  /** Home's Custom range, last in the period switch. It submits the store showing, so a store switch still loading is kept. */
  custom?: { range: { from: string; to: string } | null; min: string; max: string }
}) {
  const router = useRouter()
  const [shown, setShown] = useOptimistic<View>({ store, period })
  const [pending, setPending] = useOptimistic(false)

  // A custom range still loading has no server-built links yet: a store switch then keeps its dates.
  const urlOf = (v: View) => (v.period === 'custom' && v.from && v.to ? customHref(v.store, v.from, v.to) : hrefs[viewKey(v)])
  function go(next: View) {
    markNavigated()
    startTransition(() => {
      setShown(next)
      setPending(true)
      router.push(urlOf(next))
    })
  }

  const group = (g: Group, dim: 'store' | 'period', end?: ReactNode) => (
    <div role="group" aria-label={g.label} data-pending={pending ? '' : undefined} className={g.className}>
      {g.items.map((it) => {
        // A period pick drops any pending custom dates; a store pick keeps them.
        const next: View = dim === 'period' ? { store: shown.store, period: it.id } : { ...shown, store: it.id }
        const on = shown[dim] === it.id
        return (
          <Link key={it.id} href={urlOf(next)} aria-current={on ? 'true' : undefined}
            onClick={(e) => {
              // A new tab or window: the browser handles it. The choice already showing: nothing to load.
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
              e.preventDefault()
              if (on) return
              go(next)
            }}
            className={`${g.itemClass} ${on ? 'glass-pill-on font-semibold text-ink' : 'text-ink-2 hover:text-ink'}`}>
            {it.dot && <StoreDot id={it.dot} />}{it.label}
          </Link>
        )
      })}
      {end}
    </div>
  )

  return <>{group(stores, 'store')}{periods && group(periods, 'period',
    custom && <CustomRange store={shown.store} range={custom.range} min={custom.min} max={custom.max} itemClass={periods.itemClass}
      onApply={(from, to) => go({ store: shown.store, period: 'custom', from, to })} />)}</>
}
