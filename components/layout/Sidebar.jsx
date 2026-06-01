'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_GROUPS = [
  {
    label: 'Operations',
    items: [
      {
        label: 'Import',
        href: '/import',
        icon: (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2v9M4 7l4 4 4-4" />
            <path d="M2 13h12" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Financials',
    items: [
      {
        label: 'P&L Dashboard',
        href: '/pnl',
        icon: (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="9" width="3" height="6" rx="0.5" />
            <rect x="6" y="5" width="3" height="10" rx="0.5" />
            <rect x="11" y="1" width="3" height="14" rx="0.5" />
            <path d="M2.5 7 6 4l3 2 4-4" />
          </svg>
        ),
      },
      {
        label: 'Cash Position',
        href: '/cash',
        icon: (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="5" width="14" height="9" rx="1.5" />
            <path d="M1 8h14" />
            <circle cx="8" cy="11" r="1.5" />
            <path d="M4 3h8" />
          </svg>
        ),
      },
      {
        label: 'Orders',
        href: '/orders',
        icon: (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="12" height="13" rx="1.5" />
            <path d="M5 6h6M5 9h6M5 12h4" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Compliance',
    items: [
      {
        label: 'GST Tracker',
        href: '/gst',
        icon: (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 14V6l4-4h6a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
            <path d="M6 2v4H2" />
            <path d="M5.5 9.5h5M5.5 11.5h3" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Catalog',
    items: [
      {
        label: 'Products',
        href: '/products',
        icon: (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 4.5 8 2l6 2.5v6.5L8 13.5 2 11V4.5z" />
            <path d="M8 2v11.5M2 4.5l6 2.5 6-2.5" />
          </svg>
        ),
      },
      {
        label: 'Data',
        href: '/data',
        icon: (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="8" cy="4" rx="6" ry="2" />
            <path d="M2 4v4c0 1.1 2.7 2 6 2s6-.9 6-2V4" />
            <path d="M2 8v4c0 1.1 2.7 2 6 2s6-.9 6-2V8" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Analytics',
    items: [
      {
        label: 'RTO Tracker',
        href: '/rto',
        icon: (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="8" r="6" />
            <path d="M8 5v4l2.5 1.5" />
            <path d="M5 3 2 1M11 3l3-2" />
          </svg>
        ),
      },
      {
        label: 'COD Wallet',
        href: '/cod-wallet',
        icon: (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="4" width="14" height="10" rx="1.5" />
            <path d="M1 7h14" />
            <circle cx="11.5" cy="10.5" r="1.2" />
            <path d="M4 2h8" />
          </svg>
        ),
      },
      {
        label: 'Ad Spend',
        href: '/ad-spend',
        icon: (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12c2-4 4-6 7-3s5-2 7-5" />
            <circle cx="8" cy="9" r="1.5" />
          </svg>
        ),
      },
      {
        label: 'Forecast',
        href: '/forecast',
        icon: (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 13 5 8l3 3 3-4 3-3" />
            <path d="M11 4h4v4" />
          </svg>
        ),
      },
    ],
  },
]

export default function Sidebar() {
  const pathname = usePathname()

  const isActive = (href) =>
    href === '/pnl' ? pathname === '/pnl' || pathname === '/' : pathname.startsWith(href)

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-slate-800/60 bg-[#060d1b]">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800/60">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-950 border border-emerald-800/60">
          <svg width="13" height="13" viewBox="0 0 16 16" stroke="#34d399" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 1L1 5l7 4 7-4-7-4zM1 9l7 4 7-4" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-100 leading-none tracking-tight">Oorvia</p>
          <p className="text-[10px] text-slate-600 leading-none mt-0.5 tracking-widest uppercase">Cash OS</p>
        </div>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? 'mt-4' : ''}>
            <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-700">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors cursor-pointer ${
                      active
                        ? 'bg-emerald-500/8 text-slate-100'
                        : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 inset-y-2 w-0.5 rounded-full bg-emerald-500" />
                    )}
                    <span className={active ? 'text-emerald-400' : 'text-slate-600'}>
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom status bar */}
      <div className="px-5 py-3 border-t border-slate-800/60">
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span className="text-[10px] text-slate-600 tracking-wide">VXP Ventures · Pune</span>
        </div>
      </div>
    </aside>
  )
}
