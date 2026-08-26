'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const nextPath = params.get('next') || '/pnl'

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createSupabaseBrowserClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'That email and password combination did not match.'
          : signInError.message
      )
      setLoading(false)
      return
    }

    // Full navigation so the proxy sees the new session cookie.
    router.replace(nextPath)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-xs font-medium text-slate-400 mb-1.5">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-xs font-medium text-slate-400 mb-1.5">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
      >
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#020617] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-800/60 bg-emerald-950">
            <svg width="16" height="16" viewBox="0 0 16 16" stroke="#34d399" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 1L1 5l7 4 7-4-7-4zM1 9l7 4 7-4" />
            </svg>
          </div>
          <div>
            <p className="text-base font-semibold leading-none tracking-tight text-slate-100">Oorvia</p>
            <p className="mt-1 text-[10px] uppercase leading-none tracking-widest text-slate-600">Cash OS</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
          <h1 className="mb-1 text-lg font-semibold tracking-tight text-slate-100">Sign in</h1>
          <p className="mb-6 text-sm text-slate-500">This dashboard is private.</p>
          <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-5 text-center text-[10px] tracking-wide text-slate-700">
          VXP Ventures · Pune
        </p>
      </div>
    </div>
  )
}
