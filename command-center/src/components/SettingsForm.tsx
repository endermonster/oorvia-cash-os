'use client'

import { startTransition, useActionState, useEffect, useRef, useState } from 'react'
import type { ActionState } from '@/app/settings/actions'

type Action = (state: ActionState, f: FormData) => Promise<ActionState>

/** Bigger than this in total and Vercel refuses the request before the action runs, so stop it here. */
const MAX_TOTAL_BYTES = 4.4 * 1024 * 1024

/**
 * A form posting to a Server Action, with the result shown under it. Works before hydration too (the browser
 * queues the submit). `limitUpload` checks the chosen files' total size first.
 */
export function SettingsForm({ action, submit, pendingText = 'Saving…', className = '', tone = 'primary', limitUpload = false, children }: {
  action: Action; submit: string; pendingText?: string; className?: string; tone?: 'primary' | 'quiet' | 'danger'; limitUpload?: boolean; children?: React.ReactNode
}) {
  const [state, formAction, pending] = useActionState(action, null)
  const [tooBig, setTooBig] = useState<string | null>(null)
  const form = useRef<HTMLFormElement>(null)
  // Primary is a solid surface: .glass-pill is unlayered, so its see-through background would beat bg-ink and hide the text.
  const btn = tone === 'primary' ? 'rounded-xl bg-ink text-ground font-semibold'
    : tone === 'danger' ? 'glass-pill text-bad ring-1 ring-bad/50 hover:bg-bad/10' : 'glass-pill text-ink-2 ring-1 ring-line hover:text-ink'

  // React would clear the form after every action. Clear it only after a save that wrote something, so a failed
  // save or a "Check only" import keeps what was typed and the files chosen.
  useEffect(() => {
    if (state?.ok && !state.keepInput) form.current?.reset()
  }, [state])

  return (
    <form
      ref={form}
      action={formAction}
      onSubmit={(e) => {
        // Once hydrated, submit by hand: a form `action` makes React reset the inputs whatever the result.
        e.preventDefault()
        if (limitUpload) {
          const files = [...e.currentTarget.querySelectorAll<HTMLInputElement>('input[type=file]')].flatMap((i) => [...(i.files ?? [])])
          const total = files.reduce((s, f) => s + f.size, 0)
          if (total > MAX_TOTAL_BYTES) {
            setTooBig(`The files add up to ${(total / 1024 / 1024).toFixed(1)} MB; the limit is 4.4 MB. Upload them one at a time, or export a shorter date range.`)
            return
          }
          setTooBig(null)
        }
        const data = new FormData(e.currentTarget)
        startTransition(() => formAction(data))
      }}
      className={className}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={`h-10 px-4 text-sm focus-visible:outline-2 focus-visible:outline-sodium disabled:opacity-50 ${btn}`}>{pending ? pendingText : submit}</button>
        {tooBig ? <p role="alert" className="text-sm text-bad">{tooBig}</p>
          : state && !pending ? <p role="status" className={`text-sm ${state.ok ? 'text-good' : 'text-bad'}`}>{state.message}</p> : null}
      </div>
      {state && !pending && (state.lines?.length || state.reported?.length) ? (
        <div className="mt-3 w-full space-y-3 rounded-lg bg-ground p-4 text-xs">
          {state.reported?.length ? (
            <ul className="space-y-1 text-warn">{state.reported.map((r, i) => <li key={i}>{r}</li>)}</ul>
          ) : null}
          {state.lines?.length ? <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-ink-2">{state.lines.join('\n')}</pre> : null}
        </div>
      ) : null}
    </form>
  )
}
