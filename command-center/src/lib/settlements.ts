import { GST, gatewayRate } from './pnl'

/**
 * Gateway money captured but not yet in the bank, **estimated from Shopify** (decided 2026-11-21: no gateway API
 * keys, which cannot be read-only). Pure: the loader reads the orders.
 *
 * - A prepaid, uncancelled order's money is with its gateway until SETTLE_DAYS bank working days after the day it
 *   was placed (Razorpay, Cashfree and PayU all default to T+2). Bank working days skip Sundays and the 2nd and 4th
 *   Saturdays; public holidays are not modelled, so around one the estimate runs low.
 * - The bank receives the order value less the gateway fee and 18% GST on it, at the P&L's rates (`gatewayRate`).
 * - Refunds and holds are not seen: a cancelled order is left out as if refunded in full.
 * - Only Razorpay, PayU and Cashfree orders count. A split payment (gift card + gateway) counts in full.
 */
export const SETTLE_DAYS = 2
/** Orders older than this can't still be unsettled under T+2, even across a long weekend. */
export const LOOKBACK_DAYS = 10

export type SettlementOrder = { storeId: string; placedAt: string; gateways: string[]; totalPaise: number }
export type SettlementEstimate = { gateway: string; storeId: string; paise: number; orders: number }

const KNOWN: [RegExp, string][] = [[/razorpay/i, 'Razorpay'], [/payu/i, 'PayU'], [/cashfree/i, 'Cashfree']]

/**
 * The settling gateway that captured the order, by Shopify's gateway name. Null for anything else (a gift card,
 * no gateway, a gateway not in use): `payment = 'prepaid'` only means "not COD", not that a gateway holds cash.
 */
export function gatewayOf(gateways: string[]): string | null {
  for (const [re, name] of KNOWN) if (gateways.some((g) => re.test(g))) return name
  return null
}

/** A timestamp's calendar date in India (UTC+5:30, no DST). */
export const istDate = (ts: string) => new Date(Date.parse(ts) + 5.5 * 3_600_000).toISOString().slice(0, 10)

const utc = (date: string) => new Date(`${date}T00:00:00Z`)

export function isBankDay(date: string): boolean {
  const d = utc(date)
  const dow = d.getUTCDay()
  if (dow === 0) return false
  if (dow === 6) {
    const nth = Math.ceil(d.getUTCDate() / 7)
    return nth !== 2 && nth !== 4
  }
  return true
}

/** The bank working day `days` working days after `date` (YYYY-MM-DD). */
export function settlesOn(date: string, days = SETTLE_DAYS): string {
  const d = utc(date)
  let left = days
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (isBankDay(d.toISOString().slice(0, 10))) left--
  }
  return d.toISOString().slice(0, 10)
}

/**
 * Unsettled money per store and gateway, integer paise, net of fee + GST. An order settling today counts as
 * settled. Stores missing from `stores` are left out.
 */
export function estimateSettlements(orders: SettlementOrder[], stores: { id: string; gatewayPct: number }[], today: string): SettlementEstimate[] {
  const pct = new Map(stores.map((s) => [s.id, s.gatewayPct]))
  const out = new Map<string, SettlementEstimate>()
  for (const o of orders) {
    const storePct = pct.get(o.storeId)
    const gateway = gatewayOf(o.gateways)
    if (storePct === undefined || gateway === null || settlesOn(istDate(o.placedAt)) <= today) continue
    const fee = Math.round(o.totalPaise * gatewayRate(o.gateways, storePct) * (1 + GST))
    const key = `${o.storeId}|${gateway}`
    const row = out.get(key) ?? { gateway, storeId: o.storeId, paise: 0, orders: 0 }
    row.paise += o.totalPaise - fee
    row.orders += 1
    out.set(key, row)
  }
  return [...out.values()].sort((a, b) => a.storeId.localeCompare(b.storeId) || a.gateway.localeCompare(b.gateway))
}
