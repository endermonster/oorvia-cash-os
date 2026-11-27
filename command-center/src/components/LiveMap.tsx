'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cityOnMap } from '@/lib/cities'
import { INDIA_PATH, INDIA_VIEWBOX } from '@/lib/india-map'
import { href, type ViewState } from '@/lib/nav'
import type { RecentOrder, StoreId } from '@/lib/types'
import { useHighlight } from './LinkedHighlight'

const POLL_MS = 20_000
const FRESH_MS = 7_000
const MOCK_EVERY_MS = 6_500
const W = INDIA_VIEWBOX.width
const H = INDIA_VIEWBOX.height

const inr = (n: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n))}`
const payWord = (p: RecentOrder['payment']) => (p === 'cod' ? 'COD' : p === 'prepaid' ? 'Prepaid' : 'Unknown')
const payBg = (p: RecentOrder['payment']) => (p === 'cod' ? 'bg-cod' : p === 'prepaid' ? 'bg-prepaid' : 'bg-ink-3')
const ago = (m: number) => (m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`)

type Props = { initial: RecentOrder[]; stores: { id: StoreId; name: string }[]; serverNow: string; mock: boolean; view: ViewState }

/**
 * India with the newest orders lit at their cities. Every ~20 s it asks for the newest orders; anything not seen
 * before pops in with a ripple and a label, and joins the list below. In mock mode, demo orders arrive on a timer.
 */
export function LiveMap({ initial, stores, serverNow, mock, view }: Props) {
  const [orders, setOrders] = useState(initial)
  const [fresh, setFresh] = useState<Record<string, number>>({})
  const [elapsed, setElapsed] = useState(0)
  // The traced store (linked highlight): these parts re-render on every poll, so they set their own classes from it.
  const hl = useHighlight()
  const hlClass = (ids: string[]) => (hl === null ? '' : ids.includes(hl) ? 'hl-on' : 'hl-off')
  const seen = useRef(new Set(initial.map((o) => o.id)))
  const mounted = useRef(0)
  const name = useMemo(() => Object.fromEntries(stores.map((s) => [s.id, s.name])) as Record<StoreId, string>, [stores])

  useEffect(() => {
    mounted.current = Date.now()
    const tick = setInterval(() => setElapsed(Date.now() - mounted.current), 30_000)
    // Marks orders not seen before as arrivals (ripple + label). Returns how many there were.
    const markNew = (incoming: RecentOrder[]) => {
      const added = incoming.filter((o) => !seen.current.has(o.id))
      if (added.length === 0) return 0
      added.forEach((o) => seen.current.add(o.id))
      const at = Date.now()
      setFresh((prev) => ({ ...prev, ...Object.fromEntries(added.map((o) => [o.id, at])) }))
      setElapsed(at - mounted.current)
      return added.length
    }
    // Demo orders stack on top of the frozen mock list.
    const arrive = (incoming: RecentOrder[]) => {
      if (markNew(incoming)) setOrders((prev) => [...incoming, ...prev].slice(0, 80))
    }
    // A poll is the current truth: an edited or cancelled order is corrected or dropped, not kept from before.
    const replace = (incoming: RecentOrder[]) => {
      markNew(incoming)
      setOrders(incoming)
    }

    let poll: ReturnType<typeof setInterval> | undefined
    let demo: ReturnType<typeof setInterval> | undefined
    if (mock) {
      // Mock data is frozen; demo orders show what a live arrival looks like.
      let k = 0
      const pool = initial.length ? initial : []
      demo = setInterval(() => {
        if (pool.length === 0) return
        const base = pool[Math.floor(Math.random() * pool.length)]
        const city = DEMO_CITIES[Math.floor(Math.random() * DEMO_CITIES.length)]
        const placedAt = new Date(Date.parse(serverNow) + (Date.now() - mounted.current)).toISOString()
        arrive([{ ...base, id: `demo-${++k}-${base.id}`, city, placedAt }])
      }, MOCK_EVERY_MS)
    } else {
      const load = () => fetch('/api/orders/live', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { orders: RecentOrder[] } | null) => { if (j) replace(j.orders) })
        .catch(() => {})
      poll = setInterval(() => { if (document.visibilityState === 'visible') load() }, POLL_MS)
    }
    // Drop the "fresh" mark once its animation and label are done.
    const sweep = setInterval(() => setFresh((prev) => {
      const now = Date.now()
      const keep = Object.entries(prev).filter(([, t]) => now - t < FRESH_MS)
      return keep.length === Object.keys(prev).length ? prev : Object.fromEntries(keep)
    }), 1000)
    return () => { clearInterval(tick); clearInterval(sweep); if (poll) clearInterval(poll); if (demo) clearInterval(demo) }
  }, [initial, mock, serverNow])

  // One square per place (Delhi's districts share one): its size grows with orders, its colour is the newest order's
  // payment. Each store's own count and newest order are kept too, so a traced store's squares show only its orders.
  const cities = useMemo(() => {
    type Tally = { n: number; newest: RecentOrder }
    const m = new Map<string, Tally & { key: string; x: number; y: number; fresh: boolean; stores: StoreId[]; by: Partial<Record<StoreId, Tally>> }>()
    for (const o of orders) {
      const at = cityOnMap(o.city)
      if (!at) continue
      const key = `${Math.round(at.x)},${Math.round(at.y)}`
      const c = m.get(key)
      if (c) {
        c.n++
        if (fresh[o.id]) c.fresh = true
        const s = c.by[o.storeId]
        if (s) s.n++
        else { c.stores.push(o.storeId); c.by[o.storeId] = { n: 1, newest: o } }
      } else m.set(key, { key, x: at.x, y: at.y, n: 1, newest: o, fresh: !!fresh[o.id], stores: [o.storeId], by: { [o.storeId]: { n: 1, newest: o } } })
    }
    return [...m.values()].sort((a, b) => Number(a.fresh) - Number(b.fresh))
  }, [orders, fresh])

  const labels = orders.filter((o) => fresh[o.id] && cityOnMap(o.city) && (hl === null || hl === o.storeId)).slice(0, 2)
  const nowMs = Date.parse(serverNow) + elapsed
  const minutes = (iso: string) => Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60000))
  const unplaced = orders.filter((o) => !cityOnMap(o.city)).length

  return (
    <>
      <div className="relative mx-auto w-full max-w-[21rem]" style={{ aspectRatio: `${W} / ${H}` }}
        role="img" aria-label={`Map of India with the ${orders.length} newest orders at their cities`}>
        {/* The land is a field of grey dots, painted once on its own GPU layer: new squares and labels on top never
            repaint the 35 KB outline. */}
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full overflow-visible" aria-hidden style={{ willChange: 'transform' }}>
          <defs>
            <pattern id="land-dots" width="16" height="16" patternUnits="userSpaceOnUse">
              <circle cx="8" cy="8" r="3.1" style={{ fill: 'var(--color-map-dots)' }} />
            </pattern>
          </defs>
          <path d={INDIA_PATH} style={{ fill: 'url(#land-dots)' }} />
        </svg>

        {/* Squares are HTML so their pop is a compositor animation, never a repaint of the map. */}
        {cities.map((c) => {
          // While a store is traced, its squares count and colour only its own orders.
          const { n, newest } = (hl !== null && c.by[hl as StoreId]) || c
          const size = Math.min(18, 7 + Math.sqrt(n - 1) * 3.5)
          return (
            <span key={c.key} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${(c.x / W) * 100}%`, top: `${(c.y / H) * 100}%` }}
              title={`${newest.city}: ${n} ${n === 1 ? 'order' : 'orders'}`}>
              {/* Corners scale with the square (as in the legend), so a 1-order square doesn't round into a dot. */}
              <span data-s={c.stores.join(' ')}
                className={`map-sq block cursor-pointer ${payBg(newest.payment)} ${newest.payment === 'cod' ? 'text-cod' : 'text-prepaid'} ${c.fresh ? 'map-pop' : ''} ${hlClass(c.stores)}`}
                style={{ width: size, height: size, borderRadius: size / 4 }} />
              {c.fresh && <span aria-hidden className={`map-ring pointer-events-none absolute inset-0 ${newest.payment === 'cod' ? 'text-cod' : 'text-prepaid'}`} />}
            </span>
          )
        })}

        {labels.map((o, i) => {
          const at = cityOnMap(o.city)!
          // Open toward the wider side, and never wider than the room left there: a long city truncates, the page never scrolls.
          const x = (at.x / W) * 100
          const right = x > 50
          return (
            <span key={o.id} aria-live="polite"
              className={`map-tag absolute flex gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-[0.8125rem] font-semibold text-on-lime ${o.payment === 'prepaid' ? 'bg-prepaid' : 'bg-map-tag'} ${right ? '-translate-x-[calc(100%+14px)]' : 'translate-x-[14px]'}`}
              style={{ left: `${x}%`, top: `calc(${(at.y / H) * 100}% - ${14 + i * 30}px)`, maxWidth: `calc(${right ? x : 100 - x}% - 14px)` }}>
              <span className="min-w-0 truncate">{name[o.storeId]} · {o.city}</span>
              <span className="shrink-0">· {inr(o.value)} · {payWord(o.payment)}</span>
            </span>
          )
        })}
      </div>
      <p className="mt-2 px-3 text-center text-xs text-ink-3">
        Newest {orders.length} orders · {mock ? 'demo orders arrive every few seconds' : 'checks Shopify every 20 s'}
        {unplaced > 0 && <> · {unplaced} without a known city</>}
      </p>

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-3">
          <h3 className="text-lg font-bold">Latest orders</h3>
          <Link href={href('/orders', view)} className="flex min-h-9 items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink">All orders<ChevronRight className="size-3.5" aria-hidden /></Link>
        </div>
        {orders.length === 0 ? (
          <p className="px-2 pt-3 text-ink-3">No orders yet.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {orders.slice(0, 4).map((o) => (
              <li key={o.id} className={fresh[o.id] ? 'map-row-in' : ''}>
                <Link href={href('/orders', { ...view, store: o.storeId })} data-s={o.storeId}
                  className={`glass-row grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-start gap-2 px-3 py-2.5 ${hlClass([o.storeId])}`}>
                  <span className="flex h-lh items-center"><span aria-hidden className={`size-2 rounded-[2px] ${payBg(o.payment)}`} /></span>
                  <span className="wrap-anywhere">
                    <span className="block font-semibold">{name[o.storeId] ?? o.storeId} · {o.city}</span>
                    <span className="block text-sm text-ink-2">{o.product}</span>
                  </span>
                  <span className="whitespace-nowrap text-right tabular-nums">
                    <span className="block text-sm font-semibold leading-6">{inr(o.value)}</span>
                    <span className="block text-sm text-ink-2">{payWord(o.payment)} · {ago(minutes(o.placedAt))}</span>
                  </span>
                  <span className="-ml-1 flex h-lh items-center"><ChevronRight className="size-3.5 text-ink-3" aria-hidden /></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

const DEMO_CITIES = ['Pune', 'Mumbai', 'Bengaluru', 'Delhi', 'Hyderabad', 'Jaipur', 'Lucknow', 'Kochi', 'Indore', 'Chennai', 'Ahmedabad', 'Kolkata', 'Surat', 'Nagpur', 'Chandigarh', 'Guwahati', 'Bhubaneswar', 'Coimbatore']
