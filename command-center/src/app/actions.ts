'use server'

/**
 * NOT PUBLIC: a Server Action is a POST endpoint anyone can call, so it checks the session itself (proxy.ts gates it too).
 */
import { refresh, updateTag } from 'next/cache'

/**
 * After Sync now: drops the dashboard cache and refreshes the page in the same round trip, so it shows the new
 * figures. The sync route's own invalidation may finish after its response; this one does not. False when it did
 * neither (the session check failed): the caller then refreshes itself.
 */
export async function dropDashboardCache(): Promise<boolean> {
  // Lazy: the top bar imports this file, and its tests render it outside Next, where server-only modules cannot load.
  const [{ allowedUser }, { DATA_TAG }] = await Promise.all([import('@/lib/auth/server'), import('@/lib/cached')])
  if (!(await allowedUser())) return false
  updateTag(DATA_TAG)
  refresh()
  return true
}
