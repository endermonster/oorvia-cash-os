// Single source of truth for date handling.
//
// Everything here works in LOCAL time and formats by string padding. Do not
// reach for `toISOString()` on a date-only value: it converts to UTC first, so
// in IST (UTC+5:30) local midnight lands on the previous day and every month
// boundary silently shifts back by one. That bug behaves differently on a dev
// machine (IST) and on Vercel (UTC), which is what made it survive two earlier
// fixes.
//
// Vocabulary:
//   ymd   — 'YYYY-MM-DD'  a calendar day
//   ym    — 'YYYY-MM'     a calendar month

const pad2 = (n) => String(n).padStart(2, '0')

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_LONG  = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December']

/** Local calendar day as 'YYYY-MM-DD'. */
export function today() {
  return toYmd(new Date())
}

/** Local calendar month as 'YYYY-MM'. */
export function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

/** Date -> 'YYYY-MM-DD', using the date's LOCAL components. */
export function toYmd(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** Date -> 'YYYY-MM', using the date's LOCAL components. */
export function toYm(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
}

/** 'YYYY-MM' -> 'YYYY-MM-01' */
export function monthStart(ym) {
  return `${ym}-01`
}

/** 'YYYY-MM' -> last calendar day, e.g. '2026-08' -> '2026-08-31' */
export function monthEnd(ym) {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${pad2(daysInMonth(ym))}`
}

/** 'YYYY-MM' -> { from, to } spanning the whole month, both inclusive. */
export function monthRange(ym) {
  return { from: monthStart(ym), to: monthEnd(ym) }
}

/** Number of days in the month. Used for real proration — never assume 30. */
export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** Inclusive day count between two 'YYYY-MM-DD' values. */
export function daysBetweenInclusive(fromYmd, toYmd_) {
  const a = parseYmd(fromYmd)
  const b = parseYmd(toYmd_)
  return Math.floor((b - a) / 86400000) + 1
}

/** Shift a 'YYYY-MM' by n months (n may be negative). */
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return toYm(d)
}

/** Every 'YYYY-MM' from `fromYm` to `toYm` inclusive. */
export function monthsBetween(fromYm, toYm_) {
  const out = []
  let cur = fromYm
  while (cur <= toYm_) {
    out.push(cur)
    cur = addMonths(cur, 1)
  }
  return out
}

/** 'YYYY-MM-DD' -> Date at LOCAL midnight (not UTC, unlike `new Date(str)`). */
export function parseYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 'YYYY-MM' -> 'Aug 2026'. Pass { long: true } for 'August 2026'. */
export function fmtMonth(ym, { long = false } = {}) {
  const [y, m] = ym.split('-')
  return `${(long ? MONTH_LONG : MONTH_SHORT)[Number(m) - 1]} ${y}`
}

/** 'YYYY-MM-DD' -> '26/08/2026' for display. */
export function fmtDate(ymd) {
  if (!ymd) return '—'
  return parseYmd(String(ymd).slice(0, 10)).toLocaleDateString('en-IN')
}

export { MONTH_SHORT, MONTH_LONG, pad2 }
