'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cityOnMap } from '@/lib/cities'
import { INDIA_PATH, INDIA_VIEWBOX } from '@/lib/india-map'
import { href, type ViewState } from '@/lib/nav'
import type { RecentOrder, StoreId } from '@/lib/types'

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

  // One dot per place (Delhi's districts share one): its size grows with orders, its colour is the newest order's payment.
  const cities = useMemo(() => {
    const m = new Map<string, { key: string; x: number; y: number; n: number; newest: RecentOrder; fresh: boolean }>()
    for (const o of orders) {
      const at = cityOnMap(o.city)
      if (!at) continue
      const key = `${Math.round(at.x)},${Math.round(at.y)}`
      const c = m.get(key)
      if (c) { c.n++; if (fresh[o.id]) c.fresh = true }
      else m.set(key, { key, x: at.x, y: at.y, n: 1, newest: o, fresh: !!fresh[o.id] })
    }
    return [...m.values()].sort((a, b) => Number(a.fresh) - Number(b.fresh))
  }, [orders, fresh])

  const labels = orders.filter((o) => fresh[o.id] && cityOnMap(o.city)).slice(0, 2)
  const nowMs = Date.parse(serverNow) + elapsed
  const minutes = (iso: string) => Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60000))
  const unplaced = orders.filter((o) => !cityOnMap(o.city)).length

  return (
    <>
      <div className="relative mx-auto w-full max-w-[21rem]" style={{ aspectRatio: `${W} / ${H}` }}
        role="img" aria-label={`Map of India with the ${orders.length} newest orders at their cities`}>
        {/* The map never changes, so each SVG gets its own GPU layer and is painted once: new dots and labels on top
            no longer repaint the 35 KB outline. The glow is a CSS blur (GPU), not an SVG filter (CPU). */}
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full overflow-visible" aria-hidden
          style={{ filter: 'blur(5px)', willChange: 'transform' }}>
          <path d={INDIA_PATH} style={{ fill: 'var(--color-map-glow)' }} opacity="0.28" />
        </svg>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full overflow-visible" aria-hidden style={{ willChange: 'transform' }}>
          <defs>
            <linearGradient id="land" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--color-map-land-top)' }} />
              <stop offset="1" style={{ stopColor: 'var(--color-map-land-bottom)' }} />
            </linearGradient>
            <pattern id="land-dots" width="14" height="14" patternUnits="userSpaceOnUse">
              <circle cx="7" cy="7" r="1.6" style={{ fill: 'var(--color-map-dots)' }} opacity="0.16" />
            </pattern>
          </defs>
          <path d={INDIA_PATH} fill="url(#land)" />
          <path d={INDIA_PATH} fill="url(#land-dots)" />
          <path d={INDIA_PATH} fill="none" style={{ stroke: 'var(--color-map-edge)' }} strokeOpacity="0.55" strokeWidth="2.2" strokeLinejoin="round" />
        </svg>

        {/* Dots are HTML so their pop is a compositor animation, never a repaint of the map. */}
        {cities.map((c) => {
          const size = Math.min(26, 9 + Math.sqrt(c.n - 1) * 5)
          return (
            <span key={c.key} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${(c.x / W) * 100}%`, top: `${(c.y / H) * 100}%` }}
              title={`${c.newest.city}: ${c.n} ${c.n === 1 ? 'order' : 'orders'}`}>
              <span className={`block rounded-full ${payBg(c.newest.payment)} ${c.fresh ? 'map-pop' : ''}`}
                style={{ width: size, height: size, boxShadow: `0 0 ${size}px ${size / 3}px ${`color-mix(in srgb, var(--color-${c.newest.payment === 'cod' ? 'cod' : 'prepaid'}) 55%, transparent)`}`, opacity: c.fresh ? 1 : 0.85 }} />
              {c.fresh && <span aria-hidden className={`map-ring absolute inset-0 rounded-full ${c.newest.payment === 'cod' ? 'text-cod' : 'text-prepaid'}`} />}
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
              className={`map-tag glass-pill absolute flex gap-1 whitespace-nowrap bg-map-tag px-2.5 py-1 text-[0.8125rem] font-semibold text-ink ${right ? '-translate-x-[calc(100%+14px)]' : 'translate-x-[14px]'}`}
              style={{ left: `${x}%`, top: `calc(${(at.y / H) * 100}% - ${14 + i * 30}px)`, maxWidth: `calc(${right ? x : 100 - x}% - 14px)` }}>
              <span className="min-w-0 truncate">{name[o.storeId]} · {o.city}</span>
              <span className="shrink-0">· {inr(o.value)} <span className={o.payment === 'cod' ? 'text-cod' : 'text-prepaid'}>{payWord(o.payment)}</span></span>
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
          <Link href={href('/orders', view)} className="flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink">All orders<ChevronRight className="size-4" aria-hidden /></Link>
        </div>
        {orders.length === 0 ? (
          <p className="px-2 pt-3 text-ink-3">No orders yet.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {orders.slice(0, 4).map((o) => (
              <li key={o.id} className={fresh[o.id] ? 'map-row-in' : ''}>
                <Link href={href('/orders', { ...view, store: o.storeId })} className="glass-row flex items-center gap-3 px-3 py-2.5">
                  <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${payBg(o.payment)}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{name[o.storeId] ?? o.storeId} · {o.city}</span>
                    <span className="block truncate text-sm text-ink-2">{o.product}</span>
                  </span>
                  <span className="whitespace-nowrap text-right text-sm">
                    <span className="block font-semibold sm:inline">{inr(o.value)}</span>
                    <span className="text-ink-2"><span className="hidden sm:inline"> · </span>{payWord(o.payment)} · {ago(minutes(o.placedAt))}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
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
