import { ChevronRight } from 'lucide-react'
import { Suspense } from 'react'
import { SettingsForm } from '@/components/SettingsForm'
import { Skeleton } from '@/components/Skeleton'
import { TopBar } from '@/components/TopBar'
import { StoreDot } from '@/components/bits'
import { getChrome } from '@/lib/data'
import { istNow } from '@/lib/dates'
import { inr } from '@/lib/metrics'
import { readView } from '@/lib/nav'
import { addMonths } from '@/lib/pnl'
import { GST_KIND_LABEL, GST_KINDS, STAGE_LABEL, STAGES } from '@/lib/settings'
import { loadSettings, type SettingsProduct, type SettingsRun } from '@/lib/settings-load'
import type { StoreId } from '@/lib/types'
import {
  addCapital, addFixedCost, addGstEntry, deleteCapital, deleteCogs, deleteFixedCost, deleteGstCredit, deleteGstEntry, endFixedCost, importVf,
  saveBank, saveCogs, saveGstCredit, saveRepaid, saveStage,
} from './actions'

/** The vFulfill import reads every order and shipment; give its action room (seconds). */
export const maxDuration = 60

export default function Page({ searchParams }: PageProps<'/settings'>) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Settings searchParams={searchParams} />
    </Suspense>
  )
}

const rs = (paise: number) => inr(paise / 100)
const rupees = (paise: number) => (paise / 100).toFixed(2).replace(/\.00$/, '')
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
/** To the paisa, for tax figures. */
const exact = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const th = 'label px-3 py-3 font-normal whitespace-nowrap'
// Here, not in SettingsForm: a value exported from a 'use client' file reaches a server component as a client reference, not a string.
const inputCls = 'glass-pill h-10 max-w-full border border-line-strong px-3 text-sm text-ink focus:outline-2 focus:outline-sodium'
const labelCls = 'flex flex-col gap-1 text-sm text-ink-2'

function Section({ id, title, note, children }: { id: string; title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="glass @container scroll-mt-4 px-5 py-5">
      <h2 id={id} className="text-lg font-bold tracking-tight text-ink">{title}</h2>
      {note ? <p className="mt-3 max-w-[80ch] text-sm text-ink-3">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** One disclosure for every Delete / History: same 36 px control, same chevron as Orders. */
function Disclosure({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <details className={`group ${className}`}>
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 text-sm text-ink-3 hover:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="flex size-4 shrink-0 items-center justify-center"><ChevronRight className="size-4 transition-transform group-open:[transform:rotate(90deg)]" /></span>{label}
      </summary>
      {children}
    </details>
  )
}

async function Settings({ searchParams }: { searchParams: PageProps<'/settings'>['searchParams'] }) {
  const d = await getChrome()
  const view = readView(await searchParams, d.stores)
  const today = istNow(d.now).today
  const lastMonth = addMonths(today.slice(0, 7), -1)
  const storeName = (id: string | null) => (id === null ? 'All VXP (shared)' : d.stores.find((s) => s.id === id)?.name ?? id)

  let s: Awaited<ReturnType<typeof loadSettings>> | null = null
  let error: string | null = null
  if (d.source === 'supabase') {
    try {
      s = await loadSettings()
    } catch (e) {
      console.error(`settings: ${e instanceof Error ? e.message : String(e)}`)
      error = 'Settings could not be loaded. Try again; if it keeps failing, check the server log.'
    }
  }

  return (
    <>
      <TopBar view={view} d={d} />
      <main className="mx-auto max-w-[1536px] space-y-3 px-3 pb-6 pt-3 sm:px-4">
        <div className="px-2 py-3"><h1 className="text-3xl font-extrabold tracking-tight text-ink">Settings</h1>
        <p className="mt-2 max-w-[80ch] text-sm text-ink-3">What only you can tell the dashboard: bank balance, vFulfill exports, product costs and stages, fixed costs, GST, capital &amp; loans.</p></div>

        {d.source !== 'supabase' ? (
          <p className="glass p-5 text-ink-2">Settings edits real data only: set DATA_SOURCE=supabase.</p>
        ) : error || !s ? (
          <p className="glass p-5 text-ink-2">{error}</p>
        ) : (
          <>
            <nav aria-label="Settings sections" className="glass flex flex-wrap gap-2 p-3">{[['bank-h', 'Bank balance'], ['vf-h', 'vFulfill'], ['prod-h', 'Products'], ['fixed-h', 'Fixed costs'], ['gst-h', 'GST'], ['capital-h', 'Capital & loans']].map(([id, title]) => <a key={id} href={`#${id}`} className="glass-pill px-3 py-2 text-sm text-ink-2 hover:text-ink">{title}</a>)}</nav><Section id="bank-h" title="Bank balance" note="Counts in All VXP cash only (one account for every store). The newest date wins; a second entry on the same day replaces the first.">
              <p className="text-ink">
                {s.bank[0] ? <>Latest <span className="font-semibold">{rs(s.bank[0].amountPaise)}</span> on {day(s.bank[0].enteredOn)}{s.bank[0].note ? ` · ${s.bank[0].note}` : ''}</> : 'No balance entered yet.'}
              </p>
              <SettingsForm action={saveBank} submit="Save balance" className="mt-4 flex flex-wrap items-end gap-3">
                <label className={labelCls}>Balance (₹)<input name="amount" required inputMode="decimal" placeholder="58050.75" className={`${inputCls} w-40`} /></label>
                <label className={labelCls}>On<input name="date" type="date" required defaultValue={today} max={today} className={inputCls} /></label>
                <label className={labelCls}>Note<input name="note" maxLength={200} placeholder="optional" className={`${inputCls} w-56`} /></label>
              </SettingsForm>
              {s.bank.length > 1 ? (
                <p className="mt-3 text-sm text-ink-3">Earlier: {s.bank.slice(1).map((b) => `${rs(b.amountPaise)} on ${day(b.enteredOn)}`).join(' · ')}</p>
              ) : null}
            </Section>

            <Section id="vf-h" title="vFulfill exports" note={<>Shipments (Orders → Shipments) decide delivered and RTO; transactions (Wallet → Transaction Report) carry fees, COD remittances and the wallet. Re-importing rows already stored is safe. Leave <em>Check only</em> on to see the report before anything is written.</>}>
              <p className="text-sm text-ink-2">Last shipments import: <RunText r={s.vfRuns.shipments} /> · Last transactions import: <RunText r={s.vfRuns.transactions} /></p>
              <SettingsForm action={importVf} submit="Run" pendingText="Reading… (up to a minute)" limitUpload className="mt-4 flex flex-wrap items-end gap-4">
                <label className={labelCls}>Shipments export<input name="shipments" type="file" accept=".csv,text/csv" className="h-10 text-sm text-ink-2 file:mr-3 file:h-10 file:cursor-pointer file:rounded-xl file:border file:border-line-strong file:bg-raised file:px-4 file:text-sm file:font-semibold file:text-ink hover:file:bg-ground" /></label>
                <label className={labelCls}>Transactions export<input name="transactions" type="file" accept=".csv,text/csv" className="h-10 text-sm text-ink-2 file:mr-3 file:h-10 file:cursor-pointer file:rounded-xl file:border file:border-line-strong file:bg-raised file:px-4 file:text-sm file:font-semibold file:text-ink hover:file:bg-ground" /></label>
                <label className="flex h-10 items-center gap-2 text-sm text-ink"><input name="check" type="checkbox" defaultChecked className="size-4" />Check only</label>
              </SettingsForm>
            </Section>

            <Section id="prod-h" title="Products" note={<>Cost is ex-GST, per unit, from the date given; breakeven uses today&apos;s, past orders the one in force on their date. Shopify&apos;s “cost per item” also writes here when the product sync runs and it differs, so change it in Shopify too. Stage is a label only: no figure reads it.</>}>
              <div className="-mx-3 space-y-4">{s.products.map((p) => <ProductCard key={`${p.storeId}:${p.sku}`} p={p} today={today} storeName={storeName} />)}</div>
            </Section>

            <Section id="fixed-h" title="Fixed costs" note="Monthly costs bill on their start date's day each month until the end date, quarterly ones every third month from their start; one-time costs land on their date. A store's costs count in that store's P&L; shared ones (no store) in All VXP only. End a cost that stopped; delete only one entered by mistake.">
              {s.fixedCosts.length === 0 ? <p className="text-ink-3">No fixed costs yet.</p> : (
                <div className="@container -mx-3 min-w-0">
                  <table className="w-full text-left text-sm tabular-nums @max-4xl:block @max-4xl:[&_thead]:sr-only @max-4xl:[&_tbody]:block @max-4xl:[&_tr]:block @max-4xl:[&_td]:block @max-4xl:[&_th]:block @max-4xl:[&_tbody_td]:text-left @max-4xl:[&_tbody_[data-label]]:before:mb-1 @max-4xl:[&_tbody_[data-label]]:before:block @max-4xl:[&_tbody_[data-label]]:before:text-xs @max-4xl:[&_tbody_[data-label]]:before:font-normal @max-4xl:[&_tbody_[data-label]]:before:text-ink-3 @max-4xl:[&_tbody_[data-label]]:before:content-[attr(data-label)]">
                    <thead>
                      <tr className="border-b border-line">
                        {['Cost', 'Store', 'Amount', 'Billing', 'From', 'Until', ''].map((h, i) => <th key={i} scope="col" className={`${th} ${i === 2 ? 'text-right' : ''}`}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {s.fixedCosts.map((f) => {
                        const ended = f.endDate !== null && f.endDate < today
                        return (
                          <tr key={f.id} className={`glass-row align-top @max-4xl:grid! @max-4xl:grid-cols-2 @max-4xl:gap-x-3 ${ended ? 'text-ink-3' : ''}`}>
                            <th scope="row" className="px-3 py-3 font-semibold text-ink @max-4xl:col-span-2">{f.name}{f.note ? <span className="block text-xs font-normal text-ink-3">{f.note}</span> : null}</th>
                            <td data-label="Store" className="px-3 py-3 text-ink-2 whitespace-nowrap">{f.storeId ? <span className="inline-flex items-center gap-2"><StoreDot id={f.storeId as StoreId} />{storeName(f.storeId)}</span> : storeName(null)}</td>
                            <td data-label="Amount" className="px-3 py-3 text-right text-ink">{rs(f.amountPaise)}<span className="block text-xs text-ink-3">{f.rcm ? 'from abroad: RCM' : f.gstInclusive ? 'incl. GST' : 'ex-GST'}</span></td>
                            <td data-label="Billing" className="px-3 py-3 text-ink-2">{f.frequency === 'monthly' ? 'Monthly' : f.frequency === 'quarterly' ? 'Every 3 months' : 'One-time'}</td>
                            <td data-label="From" className="px-3 py-3 text-ink-2 whitespace-nowrap">{day(f.startDate)}</td>
                            <td data-label="Until" className="px-3 py-3 text-ink-2 whitespace-nowrap @max-4xl:col-span-2">{f.frequency === 'one-time' ? '—' : f.endDate ? day(f.endDate) : 'Ongoing'}</td>
                            <td className="px-3 py-3 @max-4xl:col-span-2 @4xl:min-w-[22rem]">
                              <div className="flex flex-wrap items-center gap-x-3">
                                {f.frequency !== 'one-time' ? (
                                  <SettingsForm action={endFixedCost} submit={f.endDate ? 'Change end' : 'End'} tone="quiet" className="flex items-center gap-2">
                                    <input type="hidden" name="id" value={f.id} />
                                    <input name="end" type="date" required aria-label={`Last billing day of ${f.name}`} defaultValue={f.endDate ?? today} min={f.startDate} className={`${inputCls} w-40 shrink-0 py-1.5`} />
                                  </SettingsForm>
                                ) : null}
                                <Disclosure label="Delete…">
                                  <SettingsForm action={deleteFixedCost} submit="Delete for good" tone="danger" className="mt-2">
                                    <input type="hidden" name="id" value={f.id} />
                                  </SettingsForm>
                                </Disclosure>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <h3 className="mt-8 text-base font-semibold text-ink">Add a fixed cost</h3>
              <SettingsForm action={addFixedCost} submit="Add cost" className="mt-3 flex flex-wrap items-end gap-3">
                <label className={labelCls}>Name<input name="name" required maxLength={80} placeholder="Shopify plan" className={`${inputCls} w-48`} /></label>
                <label className={labelCls}>Store
                  <select name="store" defaultValue="" className={`${inputCls} [&_option]:bg-raised`}>
                    <option value="">All VXP (shared)</option>
                    {d.stores.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                  </select>
                </label>
                <label className={labelCls}>Amount (₹)<input name="amount" required inputMode="decimal" placeholder="1994" className={`${inputCls} w-32`} /></label>
                <label className="flex items-center gap-2 self-center pt-5 text-sm text-ink"><input name="gst" type="checkbox" className="size-4" />Amount includes GST</label>
                <label className="flex items-center gap-2 self-center pt-5 text-sm text-ink"><input name="rcm" type="checkbox" className="size-4" />Billed from abroad (RCM)</label>
                <label className={labelCls}>Billing
                  <select name="frequency" defaultValue="monthly" className={`${inputCls} [&_option]:bg-raised`}>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Every 3 months</option>
                    <option value="one-time">One-time</option>
                  </select>
                </label>
                <label className={labelCls}>From<input name="start" type="date" required defaultValue={today} className={inputCls} /></label>
                <label className={labelCls}>Until (optional)<input name="end" type="date" className={inputCls} /></label>
                <label className={labelCls}>Note<input name="note" maxLength={200} placeholder="optional" className={`${inputCls} w-48`} /></label>
              </SettingsForm>
            </Section>

            <Section id="gst-h" title="GST" note={<>One GSTIN for every store. Money estimates each return from what it already reads: delivered orders, vFulfill charges, Meta spend, checkout and gateway fees, and RCM on fixed costs billed from abroad. Enter here only what it can&apos;t see.</>}>
              <h3 className="text-base font-semibold text-ink">Credit ledger after filing</h3>
              <p className="mt-1 max-w-[80ch] text-sm text-ink-3">After each GSTR-3B, copy the total (IGST + CGST + SGST) from the portal: Services → Ledgers → Electronic Credit Ledger. Money treats the months after the latest one as not filed yet.</p>
              {s.gst.seeds.length === 0 ? <p className="mt-3 text-warn">No balance entered: Money starts the credit ledger at ₹0 this month.</p> : (
                <ul className="mt-3 space-y-3 text-sm">
                  {s.gst.seeds.map((g, i) => (
                    <li key={g.month} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <span className={i === 0 ? 'font-semibold text-ink' : 'text-ink-2'}>After {monthName(g.month)}: {exact(g.balancePaise)}</span>
                      {g.note ? <span className="max-w-[80ch] text-xs text-ink-3">{g.note}</span> : null}
                      <Disclosure label="Delete…">
                        <SettingsForm action={deleteGstCredit} submit="Delete for good" tone="danger" className="mt-2">
                          <input type="hidden" name="month" value={g.month} />
                        </SettingsForm>
                      </Disclosure>
                    </li>
                  ))}
                </ul>
              )}
              <SettingsForm action={saveGstCredit} submit="Save balance" className="mt-4 flex flex-wrap items-end gap-3">
                <label className={labelCls}>Return filed for<input name="month" type="month" required max={lastMonth} defaultValue={lastMonth} className={inputCls} /></label>
                <label className={labelCls}>Credit left (₹)<input name="balance" required inputMode="decimal" placeholder="17369.99" className={`${inputCls} w-40`} /></label>
                <label className={labelCls}>Note<input name="note" maxLength={200} placeholder="optional" className={`${inputCls} w-56`} /></label>
              </SettingsForm>

              <h3 className="mt-10 text-base font-semibold text-ink">Other GST entries</h3>
              <p className="mt-1 max-w-[80ch] text-sm text-ink-3">A purchase with GST that Money doesn&apos;t read (packaging, equipment), a sale outside Shopify, or a one-off foreign charge (RCM, e.g. a Shopify app). Never vFulfill, Meta, fees or a fixed cost flagged RCM: those count already.</p>
              {s.gst.entries.length === 0 ? <p className="mt-3 text-ink-3">No entries yet.</p> : (
                <div className="mt-3 @container -mx-3 min-w-0">
                  <table className="w-full text-left text-sm tabular-nums @max-4xl:block @max-4xl:[&_thead]:sr-only @max-4xl:[&_tbody]:block @max-4xl:[&_tr]:block @max-4xl:[&_td]:block @max-4xl:[&_th]:block @max-4xl:[&_tbody_td]:text-left @max-4xl:[&_tbody_[data-label]]:before:mb-1 @max-4xl:[&_tbody_[data-label]]:before:block @max-4xl:[&_tbody_[data-label]]:before:text-xs @max-4xl:[&_tbody_[data-label]]:before:font-normal @max-4xl:[&_tbody_[data-label]]:before:text-ink-3 @max-4xl:[&_tbody_[data-label]]:before:content-[attr(data-label)]">
                    <thead>
                      <tr className="border-b border-line">
                        {['Month', 'Kind', 'Supplier', 'Taxable', 'GST', ''].map((h, i) => <th key={i} scope="col" className={`${th} ${i === 3 || i === 4 ? 'text-right' : ''}`}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {s.gst.entries.map((e) => (
                        <tr key={e.id} className="glass-row align-top">
                          <td data-label="Month" className="px-3 py-3 text-ink-2 whitespace-nowrap">{monthName(e.month)}</td>
                          <td data-label="Kind" className="px-3 py-3 text-ink-2">{GST_KIND_LABEL[e.kind]}</td>
                          <th scope="row" className="px-3 py-3 font-semibold text-ink">{e.source}{e.description || e.note ? <span className="block text-xs font-normal text-ink-3">{[e.description, e.note].filter(Boolean).join(' · ')}</span> : null}</th>
                          <td data-label="Taxable" className="px-3 py-3 text-right text-ink-2">{exact(e.taxablePaise)}<span className="block text-xs text-ink-3">at {e.rate}%</span></td>
                          <td data-label="GST" className="px-3 py-3 text-right font-semibold text-ink">{exact(e.gstPaise)}</td>
                          <td className="px-3 py-3 @max-4xl:col-span-2">
                            <Disclosure label="Delete…">
                              <SettingsForm action={deleteGstEntry} submit="Delete for good" tone="danger" className="mt-2">
                                <input type="hidden" name="id" value={e.id} />
                              </SettingsForm>
                            </Disclosure>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <SettingsForm action={addGstEntry} submit="Add entry" className="mt-4 flex flex-wrap items-end gap-3">
                <label className={labelCls}>Return month<input name="month" type="month" required defaultValue={today.slice(0, 7)} className={inputCls} /></label>
                <label className={labelCls}>Kind
                  <select name="kind" defaultValue="itc" className={`${inputCls} [&_option]:bg-raised`}>
                    {GST_KINDS.map((k) => <option key={k} value={k}>{GST_KIND_LABEL[k]}</option>)}
                  </select>
                </label>
                <label className={labelCls}>Supplier<input name="source" required maxLength={80} placeholder="Amazon Business" className={`${inputCls} w-44`} /></label>
                <label className={labelCls}>What<input name="description" maxLength={200} placeholder="optional" className={`${inputCls} w-44`} /></label>
                <label className={labelCls}>Taxable (₹, ex-GST)<input name="taxable" required inputMode="decimal" placeholder="1000" className={`${inputCls} w-32`} /></label>
                <label className={labelCls}>GST rate (%)<input name="rate" required inputMode="decimal" defaultValue="18" className={`${inputCls} w-20`} /></label>
                <label className={labelCls}>Note<input name="note" maxLength={200} placeholder="optional" className={`${inputCls} w-44`} /></label>
              </SettingsForm>
            </Section>

            <Section id="capital-h" title="Capital & loans" note="Money put into VXP: partners' capital, and loans with what is still owed. Interest is simple and yearly, on the full amount from the day it came in. Record repayments as the total repaid so far.">
              {s.capital.length === 0 ? <p className="text-ink-3">No entries yet.</p> : (
                <div className="@container -mx-3 min-w-0">
                  <table className="w-full text-left text-sm tabular-nums @max-4xl:block @max-4xl:[&_thead]:sr-only @max-4xl:[&_tbody]:block @max-4xl:[&_tr]:block @max-4xl:[&_td]:block @max-4xl:[&_th]:block @max-4xl:[&_tbody_td]:text-left @max-4xl:[&_tbody_[data-label]]:before:mb-1 @max-4xl:[&_tbody_[data-label]]:before:block @max-4xl:[&_tbody_[data-label]]:before:text-xs @max-4xl:[&_tbody_[data-label]]:before:font-normal @max-4xl:[&_tbody_[data-label]]:before:text-ink-3 @max-4xl:[&_tbody_[data-label]]:before:content-[attr(data-label)]">
                    <thead>
                      <tr className="border-b border-line">
                        {['Who', 'Kind', 'Amount', 'Received', 'Interest', 'Due', 'Repaid so far (₹)', ''].map((h, i) => <th key={i} scope="col" className={`${th} ${i === 2 ? 'text-right' : ''}`}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {s.capital.map((c) => (
                        <tr key={c.id} className="glass-row align-top @max-4xl:grid! @max-4xl:grid-cols-2 @max-4xl:gap-x-3">
                          <th scope="row" className="px-3 py-3 font-semibold text-ink @max-4xl:col-span-2">{c.name}{c.note ? <span className="block max-w-[40ch] text-xs font-normal text-ink-3">{c.note}</span> : null}</th>
                          <td data-label="Kind" className="px-3 py-3 text-ink-2">{c.kind === 'loan' ? 'Loan' : 'Partner capital'}</td>
                          <td data-label="Amount" className="px-3 py-3 text-right text-ink">{rs(c.amountPaise)}</td>
                          <td data-label="Received" className="px-3 py-3 text-ink-2 whitespace-nowrap">{day(c.receivedOn)}</td>
                          <td data-label="Interest" className="px-3 py-3 text-ink-2">{c.kind === 'loan' ? `${+((c.interestRate ?? 0) * 100).toFixed(2)}% a year` : '—'}</td>
                          <td data-label="Due" className="px-3 py-3 text-ink-2 whitespace-nowrap">{c.dueOn ? day(c.dueOn) : '—'}</td>
                          <td data-label="Repaid so far (₹)" className="px-3 py-3">
                            <SettingsForm action={saveRepaid} submit="Save" tone="quiet" className="flex flex-wrap items-center gap-2">
                              <input type="hidden" name="id" value={c.id} />
                              <input name="repaid" required inputMode="decimal" aria-label={`Total repaid to ${c.name}`} defaultValue={rupees(c.repaidPaise)} className={`${inputCls} w-32 py-1.5`} />
                            </SettingsForm>
                          </td>
                          <td className="px-3 py-3">
                            <Disclosure label="Delete…">
                              <SettingsForm action={deleteCapital} submit="Delete for good" tone="danger" className="mt-2">
                                <input type="hidden" name="id" value={c.id} />
                              </SettingsForm>
                            </Disclosure>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <h3 className="mt-8 text-base font-semibold text-ink">Add a loan or partner capital</h3>
              <SettingsForm action={addCapital} submit="Add" className="mt-3 flex flex-wrap items-end gap-3">
                <label className={labelCls}>Kind
                  <select name="kind" defaultValue="loan" className={`${inputCls} [&_option]:bg-raised`}>
                    <option value="loan">Loan</option>
                    <option value="partner">Partner capital</option>
                  </select>
                </label>
                <label className={labelCls}>Who<input name="name" required maxLength={80} placeholder="Lender or partner" className={`${inputCls} w-48`} /></label>
                <label className={labelCls}>Amount (₹)<input name="amount" required inputMode="decimal" placeholder="100000" className={`${inputCls} w-36`} /></label>
                <label className={labelCls}>Received<input name="received" type="date" required defaultValue={today} max={today} className={inputCls} /></label>
                <label className={labelCls}>Interest (% a year, loans)<input name="rate" inputMode="decimal" placeholder="0" className={`${inputCls} w-24`} /></label>
                <label className={labelCls}>Due (loans, optional)<input name="due" type="date" className={inputCls} /></label>
                <label className={labelCls}>Note<input name="note" maxLength={200} placeholder="optional" className={`${inputCls} w-48`} /></label>
              </SettingsForm>
            </Section>
          </>
        )}
      </main>
    </>
  )
}

function RunText({ r }: { r: SettingsRun | null }) {
  if (!r) return <span className="text-warn">never</span>
  return <span className={r.ok ? 'text-ink' : 'text-warn'}>{when(r.finishedAt)}{r.ok ? '' : ' (with skipped rows)'}</span>
}

function ProductCard({ p, today, storeName }: { p: SettingsProduct; today: string; storeName: (id: string) => string }) {
  const current = [...p.costs].reverse().find((c) => c.effectiveFrom <= today) ?? null
  const future = p.costs.filter((c) => c.effectiveFrom > today)
  return (
    <div className="glass-row p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="flex items-start gap-2 font-semibold text-ink">
          <span className="flex h-lh items-center"><StoreDot id={p.storeId as StoreId} /></span>
          <span className="min-w-0">{p.name}<span className="ml-2 text-sm font-normal text-ink-3">{p.sku} · {storeName(p.storeId)} · {rs(p.pricePaise)}</span></span>
        </p>
        <SettingsForm action={saveStage} submit="Set stage" tone="quiet" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="store" value={p.storeId} />
          <input type="hidden" name="sku" value={p.sku} />
          <select name="stage" defaultValue={p.stage} aria-label={`Stage of ${p.name}`} className={`${inputCls} py-1.5 [&_option]:bg-raised`}>
            {STAGES.map((st) => <option key={st} value={st}>{STAGE_LABEL[st]}</option>)}
          </select>
        </SettingsForm>
      </div>
      <p className={`mt-2 text-sm ${current ? 'text-ink-2' : 'text-warn'}`}>
        {current ? <>Cost today <span className="font-semibold text-ink">{rs(current.cogsPaise)}</span> ex-GST, since {day(current.effectiveFrom)}</> : 'No cost on record: breakeven and profit can’t be worked out for it.'}
        {future.length ? ` · then ${future.map((c) => `${rs(c.cogsPaise)} from ${day(c.effectiveFrom)}`).join(', ')}` : ''}
      </p>
      <div className="mt-4 flex flex-wrap items-start gap-x-10 gap-y-4">
        <SettingsForm action={saveCogs} submit="Save cost" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="store" value={p.storeId} />
          <input type="hidden" name="sku" value={p.sku} />
          <label className={labelCls}>New cost (₹, ex-GST)<input name="cogs" required inputMode="decimal" placeholder={current ? rupees(current.cogsPaise) : '300'} className={`${inputCls} w-36`} /></label>
          <label className={labelCls}>From<input name="from" type="date" required defaultValue={today} className={inputCls} /></label>
        </SettingsForm>
        {p.costs.length > 0 ? (
          <Disclosure label={`History (${p.costs.length})`} className="text-sm">
            <ul className="mt-2 space-y-2">
              {[...p.costs].reverse().map((c) => (
                <li key={c.effectiveFrom} className="flex flex-wrap items-center gap-3">
                  <span className="w-28 text-ink-2">{day(c.effectiveFrom)}</span>
                  <span className="w-24 text-right text-ink tabular-nums">{rs(c.cogsPaise)}</span>
                  <SettingsForm action={deleteCogs} submit="Remove" tone="danger" className="flex items-center gap-2">
                    <input type="hidden" name="store" value={p.storeId} />
                    <input type="hidden" name="sku" value={p.sku} />
                    <input type="hidden" name="from" value={c.effectiveFrom} />
                  </SettingsForm>
                </li>
              ))}
            </ul>
          </Disclosure>
        ) : null}
      </div>
    </div>
  )
}
