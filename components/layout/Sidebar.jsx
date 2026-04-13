'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  {
    label: 'P&L Dashboard',
    href: '/pnl',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="9" width="3" height="6" rx="0.5" />
        <rect x="6" y="5" width="3" height="10" rx="0.5" />
        <rect x="11" y="1" width="3" height="14" rx="0.5" />
        <path d="M2.5 7 6 4l3 2 4-4" />
      </svg>
    ),
  },
  {
    label: 'Orders',
    href: '/orders',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="12" height="13" rx="1.5" />
        <path d="M5 6h6M5 9h6M5 12h4" />
      </svg>
    ),
  },
  {
    label: 'GST Tracker',
    href: '/gst',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 14V6l4-4h6a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
        <path d="M6 2v4H2" />
        <path d="M5.5 9.5h5M5.5 11.5h3" />
        <circle cx="11" cy="11" r="3.5" fill="currentColor" fillOpacity="0.12" stroke="currentColor" />
        <path d="M11 9.5v1.5l1 1" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    label: 'Products',
    href: '/products',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 4.5 8 2l6 2.5v6.5L8 13.5 2 11V4.5z" />
        <path d="M8 2v11.5M2 4.5l6 2.5 6-2.5" />
      </svg>
    ),
  },
  {
    label: 'RTO Tracker',
    href: '/rto',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12c2-4 4-6 7-3s5-2 7-5" />
        <circle cx="8" cy="9" r="1.5" />
      </svg>
    ),
  },
]

export default function Sidebar() {
  const pathname = usePathname()

  const isActive = (href) =>
    href === '/pnl' ? pathname === '/pnl' || pathname === '/' : pathname.startsWith(href)

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      {/* Logo */}
      <div className="flex items-center gap-2 px-5 py-5 border-b border-zinc-800">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="white">
            <path d="M8 1L1 5l7 4 7-4-7-4zM1 9l7 4 7-4M1 13l7 4 7-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-zinc-100 leading-none">Oorvia</p>
          <p className="text-[10px] text-zinc-500 leading-none mt-0.5">Cash OS</p>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
          Accounting
        </p>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
              isActive(item.href)
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
            }`}
          >
            <span className={isActive(item.href) ? 'text-blue-400' : 'text-zinc-500'}>
              {item.icon}
            </span>
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
