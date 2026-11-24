import Link from 'next/link'
import { AlertTriangle, Database, House, Infinity as MetaMark, Megaphone, Package, Settings } from 'lucide-react'
import type { Chrome } from '@/lib/data'
import { PERIODS } from '@/lib/metrics'
import { href, TABS, type Tab, type ViewState } from '@/lib/nav'
import { vfState } from './bits'
import { SwitchGroup } from './SwitchGroup'
import { SyncButton } from './SyncButton'

const ICON = { home: House, ads: Megaphone, orders: Package, money: Database } as const
const seg = 'rounded-[0.6rem] px-3.5 py-[5px] text-sm font-medium whitespace-nowrap transition-colors'
const navSeg = `${seg} flex shrink-0 items-center justify-center max-sm:size-10 max-sm:p-0`
const freshnessChip = 'glass-pill inline-grid grid-cols-[auto_1fr] items-center px-2.5 py-[3px] sm:inline-flex'
const freshnessAge = 'col-span-2 text-xs sm:text-[0.8125rem]'
export const pageFrame = 'mx-auto max-w-[1536px] px-3 sm:px-4'

/** vFulfill data older than this is called out, not just dated. */
const VF_STALE_DAYS = 2

export function TopBar({ tab, view, d }: { tab?: Tab; view: ViewState; d: Chrome }) {
  const tabPath = TABS.find((t) => t.id === tab)?.path
  const s = d.sync
  const unconnected = s.metaNotConnected.map((id) => d.stores.find((x) => x.id === id)?.name ?? id)
  const stores = [{ id: 'all' as const, name: 'All VXP' }, ...d.stores.map((x) => ({ id: x.id, name: x.name }))]

  const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`
  const mins = (n: number) => (n < 60 ? `${n} min ago` : n < 1440 ? `${Math.floor(n / 60)} h ago` : `${days(Math.floor(n / 1440))} ago`)
  const shopify = s.shopifyMinutesAgo === null ? 'never synced' : s.shopifyMinutesAgo <= 15 ? 'live' : mins(s.shopifyMinutesAgo)
  const meta = s.metaMinutesAgo === null ? (unconnected.length ? 'not connected' : 'never synced') : mins(s.metaMinutesAgo)
  const vfs = vfState(s, (id) => d.stores.find((x) => x.id === id)?.name ?? id, VF_STALE_DAYS)
  const vfStale = vfs.stale
  const vf = vfs.short

  return (
    <header className={`${pageFrame} pt-1.5`}>
      <div className="glass px-5 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 sm:gap-x-5">
          <Link href={href('/', view)} className="flex items-baseline gap-2 sm:pr-2">
            <span className="text-[1.65rem] font-extrabold leading-none tracking-[-0.03em]">VXP</span>
            {/* Below ~1360 px the subtitle would push the period switch onto a second row. */}
            <span className="hidden text-[0.95rem] font-medium text-ink-2 min-[1360px]:inline">Command Center</span>
          </Link>

          {/* Icon-only tabs and Settings fit beside the VXP wordmark at 390 px. */}
          <nav aria-label="Sections" className="glass-pill flex max-w-full items-center gap-0.5 overflow-x-auto p-[3px] no-scrollbar max-sm:grow max-sm:justify-between max-sm:gap-2">
            {TABS.map((t) => {
              const Icon = ICON[t.id]
              const on = t.id === tab
              return (
                <Link key={t.id} href={href(t.path, view)} aria-current={on ? 'page' : undefined}
                  title={t.label} className={`${navSeg} gap-2 ${on ? 'glass-pill-on text-ink' : 'text-ink-2 hover:text-ink'}`}>
                  <Icon className="size-4" aria-hidden /><span className="sr-only sm:not-sr-only">{t.label}</span>
                </Link>
              )
            })}
            <Link href={href('/settings', view)} aria-label="Settings" aria-current={tab === undefined ? 'page' : undefined}
              title="Settings" className={`${navSeg} self-stretch ${tab === undefined ? 'glass-pill-on text-ink' : 'text-ink-2 hover:text-ink'}`}>
              <Settings className="size-4" aria-hidden />
            </Link>
          </nav>

          {tabPath && <SwitchGroup label="Store" current={view.store}
            items={stores.map((st) => ({ id: st.id, href: href(tabPath, { ...view, store: st.id }), label: st.name, dot: st.id === 'all' ? undefined : st.id }))}
            className="glass-pill flex max-w-full items-center gap-0.5 overflow-x-auto p-[3px] no-scrollbar max-sm:pr-4 max-sm:[mask-image:linear-gradient(to_right,var(--color-ink)_calc(100%_-_12px),transparent)]"
            itemClass={`${seg} flex items-center gap-2 max-sm:min-h-9`} />}

          {tabPath && (tab === 'home' || tab === 'ads') && <SwitchGroup label="Period" current={view.period}
            items={PERIODS.map((p) => ({ id: p.id, href: href(tabPath, { ...view, period: p.id }), label: p.label }))}
            className="glass-pill flex max-w-full items-center gap-0.5 overflow-x-auto p-[3px] no-scrollbar lg:ml-auto"
            itemClass={`${seg} flex items-center max-sm:min-h-9`} />}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 whitespace-nowrap text-[0.8125rem]">
          <span className={`${freshnessChip} gap-x-2`} title="Shopify orders arrive by webhook">
            <span aria-hidden className={`size-2 rounded-full ${shopify === 'live' ? 'bg-good' : 'bg-ink-3'}`} />
            <span className="font-medium text-ink">Shopify</span><span className={`${freshnessAge} text-ink-2`}>{shopify}</span>
          </span>
          <span className={`${freshnessChip} gap-x-1.5`} title={unconnected.length ? `Not connected: ${unconnected.join(', ')}` : 'Meta syncs daily and on Sync now'}>
            <MetaMark className="size-3.5 text-revenue" aria-hidden />
            <span className="font-medium text-ink">Meta</span><span className={`${freshnessAge} text-ink-2`}>{meta}</span>
          </span>
          <span className={`${freshnessChip} ${vfStale ? 'gap-x-1.5 text-warn max-sm:order-first' : 'gap-x-2'}`} title={`vFulfill arrives by CSV import: the shipments data ${vfs.phrase}`}>
            {vfStale ? <AlertTriangle className="size-3.5" aria-hidden /> : <span aria-hidden className="size-2 rounded-full bg-good" />}
            <span className={`font-medium ${vfStale ? '' : 'text-ink'}`}>vFulfill</span><span className={`${freshnessAge} ${vfStale ? '' : 'text-ink-2'}`}>{vf}</span>
            {vfStale && <span className="sr-only">(stale)</span>}
          </span>

          <div className="ml-auto flex items-center gap-2">
            {d.source === 'mock' && (
              <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-warn ring-1 ring-warn/40"
                title={`Fake numbers, frozen at ${d.now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`}>
                Mock data
              </span>
            )}
            {d.source === 'supabase' && <SyncButton />}
            <form action="/auth/signout" method="post">
              <button type="submit" className="rounded-[0.75rem] px-3 py-[3px] font-medium text-ink-3 transition-colors hover:text-ink">Sign out</button>
            </form>
          </div>
        </div>
      </div>
    </header>
  )
}
