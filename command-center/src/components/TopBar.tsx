import Link from 'next/link'
import type { Chrome } from '@/lib/data'
import { PERIODS } from '@/lib/metrics'
import { href, TABS, type Tab, type ViewState } from '@/lib/nav'
import { StoreDot } from './bits'
import { SyncButton } from './SyncButton'

const pill = 'rounded-md px-3 py-1.5 text-sm font-medium transition-colors'

export function TopBar({ tab, view, d }: { tab: Tab; view: ViewState; d: Chrome }) {
  const tabPath = TABS.find((t) => t.id === tab)!.path
  const s = d.sync
  const ago = (n: number | null, unit: string) => (n === null ? 'never' : `${n} ${unit} ago`)
  const unconnected = s.metaNotConnected.map((id) => d.stores.find((x) => x.id === id)?.name ?? id)
  const metaNote = unconnected.length > 0 ? ` (not connected: ${unconnected.join(', ')})` : ''
  const noMeta = s.metaMinutesAgo === null && unconnected.length > 0
  const stores = [{ id: 'all' as const, name: 'All VXP' }, ...d.stores.map((x) => ({ id: x.id, name: x.name }))]
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 sm:px-8 lg:px-10">
        <Link href={href('/', view)} className="text-lg font-extrabold tracking-tight">VXP</Link>

        <nav aria-label="Sections" className="flex items-center gap-1">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={href(t.path, view)}
              aria-current={t.id === tab ? 'page' : undefined}
              className={`${pill} ${t.id === tab ? 'text-ink' : 'text-ink-3 hover:text-ink-2'} relative`}
            >
              {t.label}
              {t.id === tab && <span className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-ink" />}
            </Link>
          ))}
        </nav>

        <div role="group" aria-label="Store" className="flex items-center gap-0.5 overflow-x-auto rounded-lg border border-line bg-raised p-0.5">
          {stores.map((st) => {
            const active = view.store === st.id
            return (
              <Link
                key={st.id}
                href={href(tabPath, { ...view, store: st.id })}
                aria-current={active ? 'true' : undefined}
                className={`${pill} flex items-center gap-2 whitespace-nowrap ${active ? 'bg-raised-2 text-ink shadow-[0_1px_2px_rgb(0_0_0/0.4)]' : 'text-ink-3 hover:text-ink-2'}`}
              >
                {st.id !== 'all' && <StoreDot id={st.id} />}
                {st.name}
              </Link>
            )
          })}
        </div>

        <div className="ml-auto flex items-center gap-6">
          <div role="group" aria-label="Period" className="flex items-center gap-0.5">
            {PERIODS.map((p) => (
              <Link
                key={p.id}
                href={href(tabPath, { ...view, period: p.id })}
                aria-current={view.period === p.id ? 'true' : undefined}
                className={`${pill} ${view.period === p.id ? 'bg-raised-2 text-ink' : 'text-ink-3 hover:text-ink-2'}`}
              >
                {p.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-ink-3">
            {/* The freshness text is desktop-only; the Sync button is not, so a phone can still sync. */}
            <div className="hidden items-center gap-2 md:flex" title={`Meta ${noMeta ? 'not connected' : ago(s.metaMinutesAgo, 'min')}${metaNote} · Shopify ${ago(s.shopifyMinutesAgo, 'min')} · vFulfill import ${ago(s.vfulfillImportDaysAgo, 'days')}`}>
              {!noMeta && (
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-40 motion-reduce:hidden" />
                  <span className="relative inline-flex size-2 rounded-full bg-good" />
                </span>
              )}
              {noMeta ? 'Meta not connected' : s.metaMinutesAgo === null ? 'Never synced' : `Synced ${s.metaMinutesAgo} min ago`}
            </div>
            {d.source === 'supabase' && <SyncButton />}
          </div>
          {d.source === 'mock' && (
            <span className="rounded border border-warn/40 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-warn" title={`Fake numbers, frozen at ${d.now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`}>
              Mock data
            </span>
          )}
        </div>
      </div>
    </header>
  )
}
