'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Sidebar from './Sidebar'

export default function DashboardShell({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  return (
    <div className="flex h-screen bg-[#020617] overflow-hidden">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-in-out md:relative md:translate-x-0 md:flex md:flex-shrink-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar />
      </div>

      {/* Main area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-3 px-4 h-12 border-b border-slate-800/60 bg-[#060d1b] shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-100 hover:bg-slate-800/60 transition-colors cursor-pointer"
            aria-label="Open navigation"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 4.5h14M2 9h14M2 13.5h14" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-emerald-950 border border-emerald-800/60">
              <svg width="9" height="9" viewBox="0 0 16 16" stroke="#34d399" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 1L1 5l7 4 7-4-7-4zM1 9l7 4 7-4" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-slate-100 tracking-tight">Oorvia Cash OS</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <main className="px-5 py-6 sm:px-6 sm:py-8 min-h-full">
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}
