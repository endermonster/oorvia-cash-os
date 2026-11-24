'use server'

/**
 * NOT PUBLIC: a Server Action is a POST endpoint anyone can call, so it checks the session itself (proxy.ts gates it too).
 */
import { updateTag } from 'next/cache'

/**
 * After Sync now: drops the dashboard cache and waits until it is gone, so the refresh that follows reads the new
 * figures. The sync route's own invalidation may finish after its response; this one does not.
 */
export async function dropDashboardCache(): Promise<void> {
  // Lazy: the top bar imports this file, and its tests render it outside Next, where server-only modules cannot load.
  const [{ allowedUser }, { DATA_TAG }] = await Promise.all([import('@/lib/auth/server'), import('@/lib/cached')])
  if (!(await allowedUser())) return
  updateTag(DATA_TAG)
}
