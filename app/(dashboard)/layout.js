import DashboardShell from '@/components/layout/DashboardShell'
import { getUser } from '@/lib/supabase-auth'

export default async function DashboardLayout({ children }) {
  const user = await getUser()
  return <DashboardShell userEmail={user?.email ?? null}>{children}</DashboardShell>
}
