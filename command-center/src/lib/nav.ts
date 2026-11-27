import { PERIODS, type PeriodId } from './metrics'
import type { StoreId } from './types'

export type StoreFilter = 'all' | StoreId
export type Tab = 'home' | 'ads' | 'orders' | 'money'

export const TABS: { id: Tab; label: string; path: string }[] = [
  { id: 'home', label: 'Home', path: '/' },
  { id: 'ads', label: 'Ads', path: '/ads' },
  { id: 'orders', label: 'Orders', path: '/orders' },
  { id: 'money', label: 'Money', path: '/money' },
]

/**
 * `keep`: a page's own query (the Orders month and filters) that links back to that same page carry along, so
 * switching store there doesn't also reset what's on screen. Links to other pages drop it.
 */
export type ViewState = {
  store: StoreFilter; period: PeriodId; keep?: { path: string; params: Record<string, string> }
  /** The custom range as asked (YYYY-MM-DD), only with period 'custom'. resolvePeriod clamps it. */
  from?: string; to?: string
}

type RawParams = { [key: string]: string | string[] | undefined }

/** `periods`: what the page offers (Home: HOME_PERIODS, with `custom` true). Anything else reads as 7D. */
export function readView(params: RawParams, stores: { id: string }[], periods = PERIODS, custom = false): ViewState {
  const s = typeof params.store === 'string' ? params.store : 'all'
  const p = typeof params.period === 'string' ? params.period : '7d'
  const from = typeof params.from === 'string' ? params.from : undefined
  const to = typeof params.to === 'string' ? params.to : undefined
  const store = stores.some((x) => x.id === s) ? (s as StoreId) : 'all'
  if (custom && p === 'custom' && from && to) return { store, period: 'custom', from, to }
  return { store, period: periods.some((x) => x.id === p) ? (p as PeriodId) : '7d' }
}

export function href(path: string, v: ViewState) {
  const q = new URLSearchParams()
  if (v.store !== 'all') q.set('store', v.store)
  if (v.period !== '7d') q.set('period', v.period)
  if (v.period === 'custom' && v.from && v.to) { q.set('from', v.from); q.set('to', v.to) }
  if (v.keep && v.keep.path === path) for (const [k, val] of Object.entries(v.keep.params)) q.set(k, val)
  const s = q.toString()
  return s ? `${path}?${s}` : path
}
