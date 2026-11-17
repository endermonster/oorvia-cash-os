import { PERIODS, type PeriodId } from './metrics'
import { STORES } from './mock'
import type { StoreId } from './types'

export type StoreFilter = 'all' | StoreId
export type Tab = 'home' | 'ads' | 'orders' | 'money'

export const TABS: { id: Tab; label: string; path: string }[] = [
  { id: 'home', label: 'Home', path: '/' },
  { id: 'ads', label: 'Ads', path: '/ads' },
  { id: 'orders', label: 'Orders', path: '/orders' },
  { id: 'money', label: 'Money', path: '/money' },
]

export type ViewState = { store: StoreFilter; period: PeriodId }

type RawParams = { [key: string]: string | string[] | undefined }

export function readView(params: RawParams): ViewState {
  const s = typeof params.store === 'string' ? params.store : 'all'
  const p = typeof params.period === 'string' ? params.period : '7d'
  return {
    store: STORES.some((x) => x.id === s) ? (s as StoreId) : 'all',
    period: PERIODS.some((x) => x.id === p) ? (p as PeriodId) : '7d',
  }
}

export function href(path: string, v: ViewState) {
  const q = new URLSearchParams()
  if (v.store !== 'all') q.set('store', v.store)
  if (v.period !== '7d') q.set('period', v.period)
  const s = q.toString()
  return s ? `${path}?${s}` : path
}
