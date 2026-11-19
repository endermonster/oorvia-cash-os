import 'server-only'
import { randomUUID } from 'node:crypto'
import { dbError } from './db-error'
import { supabase } from './supabase'

/** Another sync of the same source and store holds the lock: nothing was read or written. */
export class SyncBusyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncBusyError'
  }
}

export type Lock = {
  /** Extends the lock; throws if another run has taken it over (ours expired), so nothing is written on a stale view. */
  renew(): Promise<void>
}

const istTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/**
 * Runs `fn` holding the cc_sync_locks row for (source, store), so two syncs of one store never overlap: one that
 * started earlier would otherwise treat the later one's fresh rows as stale and delete them. The table's primary
 * key lets exactly one insert win. A lock past `expires_at` belongs to a run that died and is cleared first.
 * `ttlMs` must outlast the longest stretch between `renew()` calls. Released when `fn` settles.
 */
export async function withLock<T>(source: string, storeId: string, ttlMs: number, fn: (lock: Lock) => Promise<T>): Promise<T> {
  const sb = supabase()
  const holder = randomUUID()
  const now = new Date()
  const key = () => sb.from('cc_sync_locks')

  const cleared = await key().delete().eq('source', source).eq('store_id', storeId).lt('expires_at', now.toISOString())
  if (cleared.error) throw dbError('cc_sync_locks', cleared.error, cleared.status)
  const { error, status } = await key().insert({
    source, store_id: storeId, holder, acquired_at: now.toISOString(), expires_at: new Date(now.getTime() + ttlMs).toISOString(),
  })
  if (error) {
    if (error.code !== '23505') throw dbError('cc_sync_locks', error, status)
    const held = await key().select('acquired_at, expires_at').eq('source', source).eq('store_id', storeId).maybeSingle()
    const when = held.data ? ` (started ${istTime(held.data.acquired_at)}; if that run died, the lock frees at ${istTime(held.data.expires_at)})` : ''
    throw new SyncBusyError(`A ${source} sync for ${storeId} is already running${when}: try again when it finishes`)
  }

  const lock: Lock = {
    async renew() {
      const r = await key().update({ expires_at: new Date(Date.now() + ttlMs).toISOString() })
        .eq('source', source).eq('store_id', storeId).eq('holder', holder).select('holder')
      if (r.error) throw dbError('cc_sync_locks', r.error, r.status)
      if (!r.data || r.data.length === 0) throw new Error(`The ${source} sync lock for ${storeId} was lost (it expired and another sync took over): stopped before writing`)
    },
  }
  try {
    return await fn(lock)
  } finally {
    // Only our own row: a run that lost its lock must not free the one that took over. A failed release just expires.
    const released = await key().delete().eq('source', source).eq('store_id', storeId).eq('holder', holder)
    if (released.error) console.error(`cc_sync_locks ${source}/${storeId}: could not release, it expires on its own: ${released.error.message}`)
  }
}
