import Link from 'next/link'
import { AlertTriangle, Database, House, Infinity as MetaMark, Megaphone, Package } from 'lucide-react'
import type { Chrome } from '@/lib/data'
import { PERIODS } from '@/lib/metrics'
import { href, TABS, type Tab, type ViewState } from '@/lib/nav'
import { StoreDot } from './bits'
import { SyncButton } from './SyncButton'

const ICON = { home: House, ads: Megaphone, orders: Package, money: Database } as const
const seg = 'rounded-[0.6rem] px-3.5 py-[5px] text-sm font-medium whitespace-nowrap transition-colors'

/** vFulfill data older than this is called out, not just dated. */
const VF_STALE_DAYS = 2

export function TopBar({ tab, view, d }: { tab: Tab; view: ViewState; d: Chrome }) {
  const tabPath = TABS.find((t) => t.id === tab)!.path
  const s = d.sync
  const unconnected = s.metaNotConnected.map((id) => d.stores.find((x) => x.id === id)?.name ?? id)
  const stores = [{ id: 'all' as const, name: 'All VXP' }, ...d.stores.map((x) => ({ id: x.id, name: x.name }))]

  const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`
  const mins = (n: number) => (n < 60 ? `${n} min ago` : n < 1440 ? `${Math.floor(n / 60)} h ago` : `${days(Math.floor(n / 1440))} ago`)
  const shopify = s.shopifyMinutesAgo === null ? 'never synced' : s.shopifyMinutesAgo <= 15 ? 'live' : mins(s.shopifyMinutesAgo)
  const meta = s.metaMinutesAgo === null ? (unconnected.length ? 'not connected' : 'never synced') : mins(s.metaMinutesAgo)
  const vfDays = s.vfulfillImportDaysAgo
  const vfStale = vfDays === null || vfDays > VF_STALE_DAYS
  const vf = vfDays === null ? 'never imported' : vfDays === 0 ? 'today' : `${days(vfDays)} old`

  return (
    <header className="px-3 pt-1.5 sm:px-4">
      <div className="glass mx-auto max-w-[1536px] px-4 py-2.5 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
          <Link href={href('/', view)} className="flex items-baseline gap-2 pr-2">
            <span className="text-[1.65rem] font-extrabold leading-none tracking-[-0.03em]">VXP</span>
            {/* Below ~1360 px the subtitle would push the period switch onto a second row. */}
            <span className="hidden text-[0.95rem] font-medium text-ink-2 min-[1360px]:inline">Command Center</span>
          </Link>

          <nav aria-label="Sections" className="glass-pill flex max-w-full items-center gap-0.5 overflow-x-auto p-[3px] no-scrollbar">
            {TABS.map((t) => {
              const Icon = ICON[t.id]
              const on = t.id === tab
              return (
                <Link key={t.id} href={href(t.path, view)} aria-current={on ? 'page' : undefined}
                  title={t.label} className={`${seg} flex items-center gap-2 ${on ? 'glass-pill-on text-ink' : 'text-ink-2 hover:text-ink'}`}>
                  {/* Icons only on phones, so the tabs share the first row with the logo. */}
                  <Icon className="size-4" aria-hidden /><span className="sr-only sm:not-sr-only">{t.label}</span>
                </Link>
              )
            })}
          </nav>

          <div role="group" aria-label="Store" className="glass-pill flex max-w-full items-center gap-0.5 overflow-x-auto p-[3px] no-scrollbar max-sm:pr-6 max-sm:[mask-image:linear-gradient(to_right,#000_82%,transparent)]">
            {stores.map((st) => {
              const on = view.store === st.id
              return (
                <Link key={st.id} href={href(tabPath, { ...view, store: st.id })} aria-current={on ? 'true' : undefined}
                  className={`${seg} flex items-center gap-2 ${on ? 'glass-pill-on font-semibold text-ink' : 'text-ink-2 hover:text-ink'}`}>
                  {st.id !== 'all' && <StoreDot id={st.id} />}{st.name}
                </Link>
              )
            })}
          </div>

          <div role="group" aria-label="Period" className="glass-pill flex max-w-full items-center gap-0.5 overflow-x-auto p-[3px] no-scrollbar lg:ml-auto">
            {PERIODS.map((p) => {
              const on = view.period === p.id
              return (
                <Link key={p.id} href={href(tabPath, { ...view, period: p.id })} aria-current={on ? 'true' : undefined}
                  className={`${seg} ${on ? 'glass-pill-on font-semibold text-ink' : 'text-ink-2 hover:text-ink'}`}>
                  {p.label}
                </Link>
              )
            })}
          </div>
        </div>

        {/* One scrolling row on phones instead of two wrapped ones. */}
        <div className="-mx-1 mt-2 flex items-center gap-2 overflow-x-auto px-1 text-[0.8125rem] no-scrollbar max-sm:pr-6 max-sm:[mask-image:linear-gradient(to_right,#000_82%,transparent)] whitespace-nowrap sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&>*]:shrink-0">
          <span className="glass-pill flex items-center gap-2 px-3 py-[3px]" title="Shopify orders arrive by webhook">
            <span aria-hidden className={`size-2 rounded-full ${shopify === 'live' ? 'bg-good' : 'bg-ink-3'}`} />
            <span className="font-medium text-ink">Shopify</span><span className="text-ink-2">{shopify}</span>
          </span>
          <span className="glass-pill flex items-center gap-2 px-3 py-[3px]" title={unconnected.length ? `Not connected: ${unconnected.join(', ')}` : 'Meta syncs daily and on Sync now'}>
            <MetaMark className="size-4 text-revenue" aria-hidden />
            <span className="font-medium text-ink">Meta</span><span className="text-ink-2">{meta}</span>
          </span>
          <span className={`glass-pill flex items-center gap-2 px-3 py-[3px] ${vfStale ? 'text-warn max-sm:order-first' : ''}`} title="vFulfill arrives by CSV import">
            {vfStale ? <AlertTriangle className="size-3.5" aria-hidden /> : <span aria-hidden className="size-2 rounded-full bg-good" />}
            <span className={`font-medium ${vfStale ? '' : 'text-ink'}`}>vFulfill</span><span className={vfStale ? '' : 'text-ink-2'}>{vf}</span>
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
