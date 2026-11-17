import { AlertTriangle, CircleCheck, TrendingDown, TrendingUp } from 'lucide-react'
import type { Call } from '@/lib/metrics'

const ICON = {
  bad: { Icon: TrendingDown, cls: 'text-bad bg-bad/10' },
  warn: { Icon: AlertTriangle, cls: 'text-warn bg-warn/10' },
  good: { Icon: TrendingUp, cls: 'text-good bg-good/10' },
} as const

export function Calls({ calls }: { calls: Call[] }) {
  return (
    <section aria-labelledby="calls-h">
      <h2 id="calls-h" className="text-base font-semibold text-ink">Needs your call</h2>
      {calls.length === 0 ? (
        <p className="mt-4 flex items-center gap-3 text-ink-2">
          <CircleCheck className="size-5 text-good" aria-hidden />
          Nothing needs you today.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {calls.map((c) => {
            const { Icon, cls } = ICON[c.tone]
            return (
              <li key={c.id} className="flex gap-4 rounded-xl bg-raised px-4 py-3.5">
                <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${cls}`}>
                  <Icon className="size-4" aria-hidden />
                  <span className="sr-only">{c.tone === 'bad' ? 'Problem' : c.tone === 'warn' ? 'Warning' : 'Good'}</span>
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{c.title}</p>
                  <p className="mt-0.5 text-sm text-ink-2">{c.detail}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
