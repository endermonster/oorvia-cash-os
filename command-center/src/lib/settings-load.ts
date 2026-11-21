import 'server-only'
import { loadCapitalRows, loadGstInputs } from './gst-load'
import { selectAll } from './paged'
import { supabase } from './supabase'
import type { ProductStage } from './types'

type Num = number | string

export type SettingsProduct = {
  storeId: string; sku: string; name: string; pricePaise: number; stage: ProductStage
  /** Oldest first. */
  costs: { cogsPaise: number; effectiveFrom: string }[]
}
export type SettingsFixedCost = {
  id: number; storeId: string | null; name: string; amountPaise: number; frequency: 'monthly' | 'quarterly' | 'one-time'
  startDate: string; endDate: string | null; gstInclusive: boolean; rcm: boolean; note: string | null
}
export type SettingsRun = { source: string; finishedAt: string; ok: boolean }

/** Everything /settings lists: products with their cost history, fixed costs, recent bank entries, last vFulfill imports, GST entries and credit balances, capital & loans. */
export async function loadSettings() {
  const sb = supabase()
  const [products, costs, fixed, bank, runs, gst, capital] = await Promise.all([
    selectAll<{ store_id: string; sku: string; name: string; price_paise: Num; stage: ProductStage }>(
      () => sb.from('cc_products').select('store_id, sku, name, price_paise, stage').order('store_id').order('sku')),
    selectAll<{ store_id: string; sku: string; cogs_paise: Num; effective_from: string }>(
      () => sb.from('cc_cogs_history').select('store_id, sku, cogs_paise, effective_from').order('store_id').order('sku').order('effective_from')),
    selectAll<{ id: Num; store_id: string | null; name: string; amount_paise: Num; frequency: 'monthly' | 'quarterly' | 'one-time'; start_date: string; end_date: string | null; gst_inclusive: boolean; rcm: boolean; note: string | null }>(
      () => sb.from('cc_fixed_costs').select('id, store_id, name, amount_paise, frequency, start_date, end_date, gst_inclusive, rcm, note').order('start_date', { ascending: false }).order('id')),
    sb.from('cc_bank_balances').select('amount_paise, entered_on, note').order('entered_on', { ascending: false }).order('created_at', { ascending: false }).limit(5)
      .then(({ data, error }) => {
        if (error) throw new Error(`cc_bank_balances: ${error.message}`)
        return (data ?? []) as { amount_paise: Num; entered_on: string; note: string | null }[]
      }),
    // The newest finished run of each vFulfill source, read separately so many imports of one can't hide the other.
    Promise.all(['vf_shipments', 'vf_transactions'].map((source) =>
      sb.from('cc_sync_runs').select('source, finished_at, ok').eq('source', source).not('finished_at', 'is', null)
        .order('finished_at', { ascending: false }).limit(1)
        .then(({ data, error }) => {
          if (error) throw new Error(`cc_sync_runs: ${error.message}`)
          return ((data ?? []) as { source: string; finished_at: string; ok: boolean }[])[0] ?? null
        }))),
    loadGstInputs(),
    loadCapitalRows(),
  ])

  const lastRun = new Map<string, SettingsRun>()
  for (const r of runs) if (r) lastRun.set(r.source, { source: r.source, finishedAt: r.finished_at, ok: r.ok })

  return {
    products: products.map((p): SettingsProduct => ({
      storeId: p.store_id, sku: p.sku, name: p.name, pricePaise: Number(p.price_paise), stage: p.stage,
      costs: costs.filter((c) => c.store_id === p.store_id && c.sku === p.sku).map((c) => ({ cogsPaise: Number(c.cogs_paise), effectiveFrom: c.effective_from })),
    })),
    fixedCosts: fixed.map((f): SettingsFixedCost => ({
      id: Number(f.id), storeId: f.store_id, name: f.name, amountPaise: Number(f.amount_paise), frequency: f.frequency,
      startDate: f.start_date, endDate: f.end_date, gstInclusive: f.gst_inclusive, rcm: f.rcm, note: f.note,
    })),
    bank: bank.map((b) => ({ amountPaise: Number(b.amount_paise), enteredOn: b.entered_on, note: b.note })),
    gst,
    capital,
    vfRuns: { shipments: lastRun.get('vf_shipments') ?? null, transactions: lastRun.get('vf_transactions') ?? null },
  }
}
