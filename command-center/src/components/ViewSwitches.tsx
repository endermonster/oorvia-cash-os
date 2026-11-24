'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { startTransition, useOptimistic } from 'react'
import type { StoreId } from '@/lib/types'
import { viewKey } from '@/lib/view-key'
import { StoreDot } from './bits'

export type SwitchItem = { id: string; label: string; dot?: StoreId }
type View = { store: string; period: string }
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
export function ViewSwitches({ store, period, hrefs, stores, periods }: {
  store: string; period: string; hrefs: Record<string, string>; stores: Group; periods: Group | null
}) {
  const router = useRouter()
  const [shown, setShown] = useOptimistic<View>({ store, period })
  const [pending, setPending] = useOptimistic(false)

  const group = (g: Group, dim: keyof View) => (
    <div role="group" aria-label={g.label} data-pending={pending ? '' : undefined} className={g.className}>
      {g.items.map((it) => {
        const next = { ...shown, [dim]: it.id }
        const on = shown[dim] === it.id
        return (
          <Link key={it.id} href={hrefs[viewKey(next)]} aria-current={on ? 'true' : undefined}
            onClick={(e) => {
              // A new tab or window: the browser handles it. The choice already showing: nothing to load.
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
              e.preventDefault()
              if (on) return
              markNavigated()
              startTransition(() => {
                setShown(next)
                setPending(true)
                router.push(hrefs[viewKey(next)])
              })
            }}
            className={`${g.itemClass} ${on ? 'glass-pill-on font-semibold text-ink' : 'text-ink-2 hover:text-ink'}`}>
            {it.dot && <StoreDot id={it.dot} />}{it.label}
          </Link>
        )
      })}
    </div>
  )

  return <>{group(stores, 'store')}{periods && group(periods, 'period')}</>
}
