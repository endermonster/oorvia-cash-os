'use server'

/**
 * Every write /settings makes. NOT PUBLIC: proxy.ts gates the page, and each action checks the session itself
 * too (a Server Action is a POST endpoint anyone can call), so a matcher change cannot open them.
 */
import { refresh } from 'next/cache'
import { allowedUser } from '@/lib/auth/server'
import { istNow } from '@/lib/dates'
import { selectAll } from '@/lib/paged'
import { parseBank, parseCapital, parseCogs, parseEnd, parseFixedCost, parseGstCredit, parseGstEntry, parseRepaid, parseStage, type Parsed } from '@/lib/settings'
import { supabase } from '@/lib/supabase'
import { importVfulfill } from '@/lib/vfulfill/import'

/** `keepInput`: leave the form as it was (a check that wrote nothing), even though it succeeded. */
export type ActionState = { ok: boolean; message: string; lines?: string[]; reported?: string[]; keepInput?: boolean } | null

const UNAUTHORIZED: ActionState = { ok: false, message: 'Not signed in. Reload the page and sign in again.' }
/** Per file. The whole request is capped at 4.5 MB (Vercel, and next.config.ts); the form checks the total first. */
const MAX_FILE_BYTES = 4 * 1024 * 1024

async function products() {
  const rows = await selectAll<{ store_id: string; sku: string }>(() => supabase().from('cc_products').select('store_id, sku').order('store_id').order('sku'))
  return rows.map((r) => ({ storeId: r.store_id, sku: r.sku }))
}
async function storeIds() {
  return (await selectAll<{ id: string }>(() => supabase().from('cc_stores').select('id').order('id'))).map((r) => r.id)
}

/** Shared tail: a failed parse is shown as is; a database error is logged in full and shown short. */
async function write<T>(what: string, parsed: Parsed<T>, run: (v: T) => PromiseLike<{ error: { message: string } | null }>, done: (v: T) => string): Promise<ActionState> {
  if (!parsed.ok) return { ok: false, message: parsed.error }
  const { error } = await run(parsed.value)
  if (error) {
    console.error(`settings ${what}: ${error.message}`)
    return { ok: false, message: `Could not save the ${what}. Nothing changed; check the server log.` }
  }
  refresh()
  return { ok: true, message: done(parsed.value) }
}

const rs = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export async function saveBank(_: ActionState, f: FormData): Promise<ActionState> {
  if (!(await allowedUser())) return UNAUTHORIZED
  return write('bank balance', parseBank(f, istNow(new Date()).today),
    (v) => supabase().from('cc_bank_balances').insert(v),
    (v) => `Bank balance ${rs(v.amount_paise)} on ${v.entered_on} saved.`)
}

/** A new cost from a date; an entry on the same date is replaced (that is how a wrong one is corrected). */
export async function saveCogs(_: ActionState, f: FormData): Promise<ActionState> {
  if (!(await allowedUser())) return UNAUTHORIZED
  return write('cost', parseCogs(f, await products()),
    (v) => supabase().from('cc_cogs_history').upsert(v, { onConflict: 'store_id,sku,effective_from' }),
    (v) => `${v.sku}: ${rs(v.cogs_paise)} ex-GST from ${v.effective_from} saved.`)
}

/** Removes one cost entry entered on the wrong date. The product keeps its other entries. */
export async function deleteCogs(_: ActionState, f: FormData): Promise<ActionState> {
  if (!(await allowedUser())) return UNAUTHORIZED
  const parsed = parseCogs({ get: (k) => (k === 'cogs' ? '0' : f.get(k)) }, await products())
  return write('cost entry', parsed,
    (v) => supabase().from('cc_cogs_history').delete().eq('store_id', v.store_id).eq('sku', v.sku).eq('effective_from', v.effective_from),
    (v) => `${v.sku}: the entry from ${v.effective_from} is removed.`)
}

export async function saveStage(_: ActionState, f: FormData): Promise<ActionState> {
  if (!(await allowedUser())) return UNAUTHORIZED
  return write('stage', parseStage(f, await products()),
    (v) => supabase().from('cc_products').update({ stage: v.stage }).eq('store_id', v.store_id).eq('sku', v.sku),
    (v) => `${v.sku} is now ${v.stage.replace('_', ' ')}.`)
}

export async function addFixedCost(_: ActionState, f: FormData): Promise<ActionState> {
  if (!(await allowedUser())) return UNAUTHORIZED
  const parsed = parseFixedCost(f, await storeIds())
  if (parsed.ok) {
    // (store, name, start date) is unique: say so plainly rather than show the constraint error.
    let q = supabase().from('cc_fixed_costs').select('id').eq('name', parsed.value.name).eq('start_date', parsed.value.start_date)
    q = parsed.value.store_id === null ? q.is('store_id', null) : q.eq('store_id', parsed.value.store_id)
    const { data } = await q.limit(1)
    if (data && data.length > 0) return { ok: false, message: `“${parsed.value.name}” already starts on ${parsed.value.start_date}. Give it another name or date.` }
  }
  return write('fixed cost', parsed,
    (v) => supabase().from('cc_fixed_costs').insert(v),
    (v) => `${v.name}: ${rs(v.amount_paise)} ${v.frequency === 'monthly' ? 'a month' : 'once'} from ${v.start_date} saved.`)
}

/** Stops a monthly cost after a date (its last billing day). History before it stays. */
export async function endFixedCost(_: ActionState, f: FormData): Promise<ActionState> {
  if (!(await allowedUser())) return UNAUTHORIZED
  const parsed = parseEnd(f)
  if (parsed.ok) {
    const { data } = await supabase().from('cc_fixed_costs').select('start_date, frequency').eq('id', parsed.value.id).maybeSingle()
    if (!data) return { ok: false, message: 'That cost no longer exists. Reload the page.' }
    if (data.frequency !== 'monthly') return { ok: false, message: 'Only a monthly cost has an end date.' }
    if (parsed.value.end_date < data.start_date) return { ok: false, message: `End date is before the start date (${data.start_date}).` }
  }
  return write('end date', parsed,
    (v) => supabase().from('cc_fixed_costs').update({ end_date: v.end_date }).eq('id', v.id),
    (v) => `Ends on ${v.end_date}.`)
}

/** For a cost entered by mistake. A cost that really stopped should be ended instead, so past months keep it. */
export async function deleteFixedCost(_: ActionState, f: FormData): Promise<ActionState> {
  if (!(await allowedUser())) return UNAUTHORIZED
  const id = Number(f.get('id'))
  const parsed: Parsed<number> = Number.isSafeInteger(id) && id > 0 ? { ok: true, value: id } : { ok: false, error: 'Unknown cost' }
  return write('fixed cost', parsed, (v) => supabase().from('cc_fixed_costs').delete().eq('id', v), () => 'Cost removed.')
}

const idOf = (f: FormData): Parsed<number> => {
  const id = Number(f.get('id'))
  return Number.isSafeInteger(id) && id > 0 ? { ok: true, value: id } : { ok: false, error: 'Unknown entry' }
}

/** For a purchase or sale outside what the dashboard reads itself (vFulfill, Meta, fees, fixed costs). */
export async function addGstEntry(_: ActionState, f: FormData): Promise<ActionState> {
  if (!(await allowedUser())) return UNAUTHORIZED
  return write('GST entry', parseGstEntry(f),
    (v) => supabase().from('cc_gst_entries').insert(v),
    (v) => `${v.source}: GST ${rs(v.gst_paise)} in ${v.month.slice(0, 7)} saved.`)
}

export async function deleteGstEntry(_: ActionState, f: FormData): Promise<ActionState> {
  if (!(await allowedUser())) return UNAUTHORIZED
  return write('GST entry', idOf(f), (v) => supabase().from('cc_gst_entries').delete().eq('id', v), () => 'Entry removed.')
}

/** The portal's Electronic Credit Ledger total after filing a month. A second entry for the month replaces the first. */
export async function saveGstCredit(_: ActionState, f: FormData): Promise<ActionState> {
  if (!(await allowedUser())) return UNAUTHORIZED
  return write('credit balance', parseGstCredit(f, istNow(new Date()).today.slice(0, 7)),
    (v) => supabase().from('cc_gst_credit').upsert(v, { onConflict: 'month' }),
    (v) => `Credit ledger ${rs(v.balance_paise)} after filing ${v.month.slice(0, 7)} saved.`)
}

export async function deleteGstCredit(_: ActionState, f: FormData): Promise<ActionState> {
  if (!(await allowedUser())) return UNAUTHORIZED
  const month = String(f.get('month') ?? '')
  const parsed: Parsed<string> = /^\d{4}-\d{2}$/.test(month) ? { ok: true, value: `${month}-01` } : { ok: false, error: 'Unknown month' }
  return write('credit balance', parsed, (v) => supabase().from('cc_gst_credit').delete().eq('month', v), () => 'Balance removed.')
}

export async function addCapital(_: ActionState, f: FormData): Promise<ActionState> {
  if (!(await allowedUser())) return UNAUTHORIZED
  return write('entry', parseCapital(f),
    (v) => supabase().from('cc_capital').insert(v),
    (v) => `${v.name}: ${rs(v.amount_paise)} ${v.kind === 'loan' ? 'loan' : 'capital'} from ${v.received_on} saved.`)
}

/** Total repaid so far on a loan (or capital returned to a partner). */
export async function saveRepaid(_: ActionState, f: FormData): Promise<ActionState> {
  if (!(await allowedUser())) return UNAUTHORIZED
  const parsed = parseRepaid(f)
  if (parsed.ok) {
    const { data } = await supabase().from('cc_capital').select('amount_paise').eq('id', parsed.value.id).maybeSingle()
    if (!data) return { ok: false, message: 'That entry no longer exists. Reload the page.' }
    if (parsed.value.repaid_paise > Number(data.amount_paise)) return { ok: false, message: `Repaid is more than the ${rs(Number(data.amount_paise))} received.` }
  }
  return write('repaid amount', parsed,
    (v) => supabase().from('cc_capital').update({ repaid_paise: v.repaid_paise }).eq('id', v.id),
    (v) => `Repaid so far: ${rs(v.repaid_paise)}.`)
}

export async function deleteCapital(_: ActionState, f: FormData): Promise<ActionState> {
  if (!(await allowedUser())) return UNAUTHORIZED
  return write('entry', idOf(f), (v) => supabase().from('cc_capital').delete().eq('id', v), () => 'Entry removed.')
}

/** Either export or both. "Check only" reads and reports, writes nothing. */
export async function importVf(_: ActionState, f: FormData): Promise<ActionState> {
  if (!(await allowedUser())) return UNAUTHORIZED
  const file = (k: string) => {
    const v = f.get(k)
    return v instanceof File && v.size > 0 ? v : null
  }
  const ship = file('shipments'), txn = file('transactions')
  if (!ship && !txn) return { ok: false, message: 'Choose a shipments export, a transactions export, or both.' }
  for (const x of [ship, txn]) {
    if (x && x.size > MAX_FILE_BYTES) return { ok: false, message: `${x.name} is over 4 MB. Export a shorter date range from vFulfill (re-importing overlapping rows is safe).` }
    if (x && !/\.csv$/i.test(x.name)) return { ok: false, message: `${x.name} is not a .csv file.` }
  }
  const dryRun = f.get('check') === 'on'
  try {
    const { lines, reported } = await importVfulfill(supabase(), {
      shipments: ship ? await ship.text() : undefined,
      transactions: txn ? await txn.text() : undefined,
    }, dryRun)
    if (!dryRun) refresh()
    const what = [ship && 'shipments', txn && 'transactions'].filter(Boolean).join(' and ')
    return {
      ok: reported.length === 0,
      message: `${dryRun ? 'Checked' : 'Imported'} ${what}${dryRun ? ': nothing was written' : ''}.${reported.length ? ` ${reported.length} item(s) need a look.` : ''}`,
      lines: lines.map((l) => l.trim()).filter(Boolean), reported, keepInput: dryRun,
    }
  } catch (e) {
    console.error(`settings vFulfill import: ${e instanceof Error ? e.message : String(e)}`)
    return { ok: false, message: `Import failed: ${e instanceof Error ? e.message : 'unknown error'}. Rows already written stay; re-importing the same file is safe.` }
  }
}
