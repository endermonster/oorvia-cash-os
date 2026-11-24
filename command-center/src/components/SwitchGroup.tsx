'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { startTransition, useOptimistic } from 'react'
import type { StoreId } from '@/lib/types'
import { StoreDot } from './bits'

export type SwitchItem = { id: string; href: string; label: string; dot?: StoreId }

/** From the first switch on, panels show new figures at once instead of rising in (globals.css). */
function markNavigated() {
  document.documentElement.dataset.navigated = ''
}

/**
 * A store or period switch that moves to the clicked choice at once, instead of when the new page arrives. The
 * choice and `data-pending` are optimistic: they hold only while the navigation runs, then the URL-backed `current`
 * shows again (also after Back, or a navigation that fails). While pending, the page content dims (globals.css).
 */
export function SwitchGroup({ label, current, items, className, itemClass }: {
  label: string; current: string; items: SwitchItem[]; className: string; itemClass: string
}) {
  const router = useRouter()
  const [shown, setShown] = useOptimistic(current)
  const [pending, setPending] = useOptimistic(false)

  return (
    <div role="group" aria-label={label} data-pending={pending ? '' : undefined} className={className}>
      {items.map((it) => {
        const on = shown === it.id
        return (
          <Link key={it.id} href={it.href} aria-current={on ? 'true' : undefined}
            onClick={(e) => {
              // A new tab or window: the browser handles it. The choice already showing: nothing to load.
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
              e.preventDefault()
              if (it.id === shown) return
              markNavigated()
              startTransition(() => {
                setShown(it.id)
                setPending(true)
                router.push(it.href)
              })
            }}
            className={`${itemClass} ${on ? 'glass-pill-on font-semibold text-ink' : 'text-ink-2 hover:text-ink'}`}>
            {it.dot && <StoreDot id={it.dot} />}{it.label}
          </Link>
        )
      })}
    </div>
  )
}
