import Sidebar from '@/components/layout/Sidebar'

export default function DashboardLayout({ children }) {
  return (
    <div className="flex h-screen bg-zinc-950 overflow-hidden">
      <Sidebar />
      <div className="flex-1 min-w-0 overflow-y-auto">
        <main className="px-6 py-8 min-h-full">
          {children}
        </main>
      </div>
    </div>
  )
}
