import { fmtX, type StoreStats } from '@/lib/metrics'

/** Within 3% of breakeven: a 2.32× ROAS against a 2.32× breakeven is neither reassuringly covering costs nor clearly below. */
export const atBreakeven = (roas: number, be: number) => be > 0 && Math.abs(roas / be - 1) <= 0.03

/** "At breakeven" or "Just below breakeven" inside the band, so the word keeps the direction the bar's colour shows. */
export const nearBreakevenWord = (zone: StoreStats['zone']) => (zone === 'below' ? 'Just below breakeven' : 'At breakeven')

/** Segments, not a smooth bar: 9px cells with 3px gaps, as the track and the fill both show. */
const CELLS = 'repeating-linear-gradient(90deg,#000 0 9px,transparent 9px 12px)'

/**
 * ROAS on a segmented track with three zones: red below breakeven, white from breakeven to target, lime at or above
 * target. The track is faintly tinted by zone; the fill and the figure take the zone's colour. `losing`: the store
 * lost money this period, which reads red even on the breakeven line.
 */
export function RoasTrack({ roas, be, target, zone, after, note, losing = false }: { roas: number; be: number; target: number; zone: StoreStats['zone']; after?: React.ReactNode; note?: string; losing?: boolean }) {
  const max = Math.max(target * 1.12, roas * 1.05)
  const pct = (v: number) => (v / max) * 100
  const at = (v: number) => `${pct(v)}%`
  const shown = zone === null ? null : losing || zone === 'below' ? 'below' : zone
  const c = shown === null ? 'var(--color-ink-3)' : shown === 'below' ? 'var(--color-bad)' : shown === 'profit' ? 'var(--color-lime)' : 'var(--color-ink)'
  const word = zone === null ? 'Breakeven incomplete' : zone !== 'profit' && atBreakeven(roas, be) ? nearBreakevenWord(zone) : zone === 'below' ? 'Below breakeven' : zone === 'covering' ? 'Covering costs' : 'Above target'
  const track = `linear-gradient(90deg, rgb(255 90 78 / 0.26) 0 ${at(be)}, rgb(255 255 255 / 0.13) ${at(be)} ${at(target)}, rgb(184 242 58 / 0.24) ${at(target)} 100%)`
  return (
    <div title={`${word}: breakeven ${fmtX(be)}, target ${fmtX(target)}${note ? `. ${note}` : ''}`}>
      <p className="text-[1.3rem] @min-[50rem]:text-[1.125rem] @min-[60rem]:text-[1.3rem] font-semibold leading-tight" style={{ color: c }}>{fmtX(roas)}{after}<span className="sr-only"> {word}</span></p>
      <div className="relative mt-2 h-2">
        <div className="absolute inset-0" style={{ background: track, maskImage: CELLS, WebkitMaskImage: CELLS }} />
        <div className="absolute inset-y-0 left-0" style={{ width: at(Math.min(roas, max)), background: c, maskImage: CELLS, WebkitMaskImage: CELLS }} />
        {/* A dark edge keeps a tick visible when the fill runs past it. */}
        <span aria-hidden className="absolute -top-1 h-4 w-0.5 rounded-sm bg-bad ring-2 ring-raised" style={{ left: at(be) }} />
        <span aria-hidden className="absolute -top-1 h-4 w-0.5 rounded-sm bg-lime ring-2 ring-raised" style={{ left: at(target) }} />
      </div>
      {/* A key, not labels on the ticks: the two ticks sit ~60px apart, too close for two centred labels to fit. */}
      <div className="mt-1.5 flex items-center justify-between gap-3 whitespace-nowrap text-[0.6875rem] leading-none">
        <span className="flex items-center gap-1.5 text-ink-3"><span aria-hidden className="h-2.5 w-0.5 rounded-sm bg-bad" />BE {fmtX(be)}</span>
        <span className="flex items-center gap-1.5 text-ink-3"><span aria-hidden className="h-2.5 w-0.5 rounded-sm bg-lime" />Target {fmtX(target)}</span>
      </div>
      {note && <p className="mt-1 truncate text-[0.6875rem] leading-tight text-ink-3">{note}</p>}
    </div>
  )
}
