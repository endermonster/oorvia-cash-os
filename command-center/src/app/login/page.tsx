import { Suspense } from 'react'
import { LoginForm } from './LoginForm'

export const metadata = { title: 'Sign in · VXP Command Center' }

export default function Page() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <p className="text-lg font-extrabold tracking-tight text-ink">VXP</p>
        <h1 className="mt-6 text-2xl font-extrabold tracking-tight text-ink">Sign in</h1>
        <p className="mt-1 text-sm text-ink-3">Same email and password as Cash OS.</p>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  )
}
