'use client' // Error boundaries must be Client Components

import { useEffect } from 'react'

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="mx-auto max-w-[1440px] px-4 pt-24 sm:px-8 lg:px-10">
      <div className="max-w-[60ch] rounded-xl bg-raised p-8">
        <p className="text-xl font-semibold text-ink">The numbers could not be loaded.</p>
        <p className="mt-2 text-ink-2">Something went wrong reading the data. Nothing has been changed. Try again in a moment.</p>
        <button
          type="button"
          onClick={() => retry()}
          className="mt-6 rounded-md bg-raised-2 px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-line-strong"
        >
          Try again
        </button>
      </div>
    </main>
  )
}
