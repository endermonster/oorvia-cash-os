'use client'

import { createBrowserClient } from '@supabase/ssr'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { safeNext } from '@/lib/auth/gate'

const input = 'mt-1.5 w-full rounded-lg border border-line-strong bg-raised px-3 py-2 text-ink placeholder:text-ink-3 focus:border-ink-3 focus:outline-none'

export function LoginForm() {
  const params = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const form = new FormData(e.currentTarget)
    // The anon key only signs in; every data read is server-side with the service-role key, behind the gate.
    const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const { error: err } = await sb.auth.signInWithPassword({ email: String(form.get('email')), password: String(form.get('password')) })
    if (err) {
      setError(err.message === 'Invalid login credentials' ? 'That email and password did not match.' : err.message)
      setBusy(false)
      return
    }
    // A full load, so the proxy sees the new session cookie. Same-site paths only.
    window.location.assign(safeNext(params.get('next')))
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      <label className="block text-sm text-ink-2">
        Email
        <input name="email" type="email" autoComplete="username" required autoFocus className={input} />
      </label>
      <label className="block text-sm text-ink-2">
        Password
        <input name="password" type="password" autoComplete="current-password" required className={input} />
      </label>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <button type="submit" disabled={busy} className="w-full rounded-lg bg-ink px-3 py-2 font-semibold text-ground transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60">
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
