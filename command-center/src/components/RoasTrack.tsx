import { fmtX, type StoreStats } from '@/lib/metrics'

export function RoasTrack({ roas, be, target, zone, after, note }: { roas: number; be: number; target: number; zone: StoreStats['zone']; after?: React.ReactNode; note?: string }) {
  const max = Math.max(target * 1.12, roas * 1.05)
  const at = (v: number) => `${(v / max) * 100}%`
  const fill = zone === null ? 'bg-ink-3' : zone === 'below' ? 'bg-bad' : zone === 'profit' ? 'bg-good' : 'bg-revenue'
  const word = zone === null ? 'Breakeven incomplete' : zone === 'below' ? 'Below breakeven' : zone === 'covering' ? 'Covering costs' : 'Above target'
  return (
    <div title={`${word}: breakeven ${fmtX(be)}, target ${fmtX(target)}${note ? `. ${note}` : ''}`}>
      <p className={`text-[1.3rem] @min-[50rem]:text-[1.125rem] @min-[60rem]:text-[1.3rem] font-bold leading-tight ${zone === null ? 'text-ink-2' : zone === 'below' ? 'text-bad' : 'text-revenue'}`}>{fmtX(roas)}{after}<span className="sr-only"> {word}</span></p>
      <div className="relative mt-1.5 h-2 rounded-full bg-line-strong/75">
        <div className={`absolute inset-y-0 left-0 rounded-full ${fill}`} style={{ width: at(roas) }} />
        {/* Dark edge keeps a tick visible when the fill of the same colour runs past it. */}
        <span aria-hidden className="absolute -top-1 h-4 w-0.5 rounded bg-bad ring-1 ring-ground/85" style={{ left: at(be) }} />
        <span aria-hidden className="absolute -top-1 h-4 w-0.5 rounded bg-good ring-1 ring-ground/85" style={{ left: at(target) }} />
      </div>
      {/* A key, not labels on the ticks: the two ticks sit ~60px apart, too close for two centred labels to fit. */}
      <div className="mt-1.5 flex items-center justify-between gap-3 whitespace-nowrap text-[0.6875rem] leading-none">
        <span className="flex items-center gap-1.5 text-ink-2"><span aria-hidden className="h-2.5 w-0.5 rounded bg-bad" />BE {fmtX(be)}</span>
        <span className="flex items-center gap-1.5 text-ink-2"><span aria-hidden className="h-2.5 w-0.5 rounded bg-good" />Target {fmtX(target)}</span>
      </div>
      {note && <p className="mt-1 truncate text-[0.6875rem] leading-tight text-ink-3">{note}</p>}
    </div>
  )
}
