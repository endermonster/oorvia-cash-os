'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { dropDashboardCache } from '@/app/actions'
import { summarize, type Outcome } from '@/lib/sync-outcome'

export function SyncButton() {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [refreshing, startRefresh] = useTransition()
  const busy = running || refreshing

  async function run() {
    setRunning(true)
    setError(null)
    setNote(null)
    try {
      const res = await fetch('/api/sync/meta', { method: 'POST' })
      const body = (await res.json().catch(() => null)) as Outcome | null
      const d = summarize(body)
      setError(res.ok ? d.alert : (d.alert ?? 'Sync failed'))
      setNote(d.note)
      // Also on a partial failure: the stores that did sync have new numbers. The action drops the cache and
      // refreshes the page in one round trip; if it fails, a plain refresh still shows what it can.
      startRefresh(async () => {
        try {
          await dropDashboardCache()
        } catch {
          router.refresh()
        }
      })
    } catch {
      setError('Sync failed: could not reach the server')
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="glass-pill px-3 py-[3px] font-medium text-ink-2 transition-colors hover:text-ink disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? 'Syncing…' : 'Sync now'}
      </button>
      {note && !error && <span className="max-w-64 truncate text-ink-3" title={note}>{note}</span>}
      {error && <span role="alert" className="max-w-64 truncate text-warn" title={error}>{error}</span>}
    </>
  )
}
