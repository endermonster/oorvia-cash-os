import { Suspense } from 'react'
import { SettingsForm } from '@/components/SettingsForm'
import { Skeleton } from '@/components/Skeleton'
import { TopBar } from '@/components/TopBar'
import { StoreDot } from '@/components/bits'
import { getChrome } from '@/lib/data'
import { istNow } from '@/lib/dates'
import { inr } from '@/lib/metrics'
import { readView } from '@/lib/nav'
import { STAGE_LABEL, STAGES } from '@/lib/settings'
import { loadSettings, type SettingsProduct, type SettingsRun } from '@/lib/settings-load'
import type { StoreId } from '@/lib/types'
import { addFixedCost, deleteCogs, deleteFixedCost, endFixedCost, importVf, saveBank, saveCogs, saveStage } from './actions'

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
const th = 'label px-4 py-3 font-normal whitespace-nowrap'
// Here, not in SettingsForm: a value exported from a 'use client' file reaches a server component as a client reference, not a string.
const inputCls = 'rounded-md border border-line-strong bg-raised px-3 py-2 text-ink'
const labelCls = 'flex flex-col gap-1 text-sm text-ink-2'

function Section({ id, title, note, children }: { id: string; title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-12 border-t border-line pt-8">
      <h2 id={id} className="text-xl font-bold tracking-tight text-ink">{title}</h2>
      {note ? <p className="mt-1 max-w-[80ch] text-sm text-ink-3">{note}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  )
}

async function Settings({ searchParams }: { searchParams: PageProps<'/settings'>['searchParams'] }) {
  const d = await getChrome()
  const view = readView(await searchParams, d.stores)
  const today = istNow(d.now).today
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
      {/* Settings is not a tab: the bar shows Money, where its link lives, until the top bar gets its gear. */}
      <TopBar tab="money" view={view} d={d} />
      <main className="mx-auto max-w-[1440px] px-4 py-10 sm:px-8 lg:px-10">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">Settings</h1>
        <p className="mt-2 max-w-[80ch] text-sm text-ink-3">What only you can tell the dashboard: bank balance, vFulfill exports, product costs and stages, fixed costs.</p>

        {d.source !== 'supabase' ? (
          <p className="mt-8 rounded-xl bg-raised p-6 text-ink-2">Settings edits real data only: set DATA_SOURCE=supabase.</p>
        ) : error || !s ? (
          <p className="mt-8 rounded-xl bg-raised p-6 text-ink-2">{error}</p>
        ) : (
          <>
            <Section id="bank-h" title="Bank balance" note="Counts in All VXP cash only (one account for every store). The newest date wins; a second entry on the same day replaces the first.">
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
                <label className={labelCls}>Shipments export<input name="shipments" type="file" accept=".csv,text/csv" className="text-sm text-ink-2" /></label>
                <label className={labelCls}>Transactions export<input name="transactions" type="file" accept=".csv,text/csv" className="text-sm text-ink-2" /></label>
                <label className="flex items-center gap-2 self-center text-sm text-ink"><input name="check" type="checkbox" defaultChecked className="size-4" />Check only</label>
              </SettingsForm>
            </Section>

            <Section id="prod-h" title="Products" note={<>Cost is ex-GST, per unit, from the date given; breakeven uses today&apos;s, past orders the one in force on their date. Shopify&apos;s “cost per item” also writes here when the product sync runs and it differs, so change it in Shopify too. Stage is a label only: no figure reads it.</>}>
              <div className="space-y-4">{s.products.map((p) => <ProductCard key={`${p.storeId}:${p.sku}`} p={p} today={today} storeName={storeName} />)}</div>
            </Section>

            <Section id="fixed-h" title="Fixed costs" note="Monthly costs bill on their start date's day each month until the end date; one-time costs land on their date. A store's costs count in that store's P&L; shared ones (no store) in All VXP only. End a cost that stopped; delete only one entered by mistake.">
              {s.fixedCosts.length === 0 ? <p className="text-ink-3">No fixed costs yet.</p> : (
                <div className="overflow-x-auto rounded-xl bg-raised">
                  <table className="w-full min-w-[980px] text-left text-sm tabular-nums">
                    <thead>
                      <tr className="border-b border-line">
                        {['Cost', 'Store', 'Amount', 'Billing', 'From', 'Until', ''].map((h, i) => <th key={i} scope="col" className={`${th} ${i === 2 ? 'text-right' : ''}`}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {s.fixedCosts.map((f) => {
                        const ended = f.endDate !== null && f.endDate < today
                        return (
                          <tr key={f.id} className={`border-b border-line align-top last:border-0 ${ended ? 'text-ink-3' : ''}`}>
                            <th scope="row" className="px-4 py-3 font-semibold text-ink">{f.name}{f.note ? <span className="block text-xs font-normal text-ink-3">{f.note}</span> : null}</th>
                            <td className="px-4 py-3 text-ink-2 whitespace-nowrap">{f.storeId ? <span className="inline-flex items-center gap-2"><StoreDot id={f.storeId as StoreId} />{storeName(f.storeId)}</span> : storeName(null)}</td>
                            <td className="px-4 py-3 text-right text-ink">{rs(f.amountPaise)}<span className="block text-xs text-ink-3">{f.gstInclusive ? 'incl. GST' : 'ex-GST'}</span></td>
                            <td className="px-4 py-3 text-ink-2">{f.frequency === 'monthly' ? 'Monthly' : 'One-time'}</td>
                            <td className="px-4 py-3 text-ink-2 whitespace-nowrap">{day(f.startDate)}</td>
                            <td className="px-4 py-3 text-ink-2 whitespace-nowrap">{f.frequency === 'one-time' ? '—' : f.endDate ? day(f.endDate) : 'Ongoing'}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap items-start gap-3">
                                {f.frequency === 'monthly' ? (
                                  <SettingsForm action={endFixedCost} submit={f.endDate ? 'Change end' : 'End'} tone="quiet" className="flex flex-wrap items-center gap-2">
                                    <input type="hidden" name="id" value={f.id} />
                                    <input name="end" type="date" required aria-label={`Last billing day of ${f.name}`} defaultValue={f.endDate ?? today} min={f.startDate} className={`${inputCls} py-1.5`} />
                                  </SettingsForm>
                                ) : null}
                                <details>
                                  <summary className="cursor-pointer py-1.5 text-sm text-ink-3 hover:text-ink">Delete…</summary>
                                  <SettingsForm action={deleteFixedCost} submit="Delete for good" tone="danger" className="mt-2">
                                    <input type="hidden" name="id" value={f.id} />
                                  </SettingsForm>
                                </details>
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
                  <select name="store" defaultValue="" className={inputCls}>
                    <option value="">All VXP (shared)</option>
                    {d.stores.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                  </select>
                </label>
                <label className={labelCls}>Amount (₹)<input name="amount" required inputMode="decimal" placeholder="1994" className={`${inputCls} w-32`} /></label>
                <label className="flex items-center gap-2 self-center pt-5 text-sm text-ink"><input name="gst" type="checkbox" className="size-4" />Amount includes GST</label>
                <label className={labelCls}>Billing
                  <select name="frequency" defaultValue="monthly" className={inputCls}>
                    <option value="monthly">Monthly</option>
                    <option value="one-time">One-time</option>
                  </select>
                </label>
                <label className={labelCls}>From<input name="start" type="date" required defaultValue={today} className={inputCls} /></label>
                <label className={labelCls}>Until (monthly, optional)<input name="end" type="date" className={inputCls} /></label>
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
    <div className="rounded-xl bg-raised p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="font-semibold text-ink">
          <span className="inline-flex items-center gap-2"><StoreDot id={p.storeId as StoreId} />{p.name}</span>
          <span className="ml-2 text-sm font-normal text-ink-3">{p.sku} · {storeName(p.storeId)} · {rs(p.pricePaise)}</span>
        </p>
        <SettingsForm action={saveStage} submit="Set stage" tone="quiet" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="store" value={p.storeId} />
          <input type="hidden" name="sku" value={p.sku} />
          <select name="stage" defaultValue={p.stage} aria-label={`Stage of ${p.name}`} className={`${inputCls} py-1.5`}>
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
          <details className="text-sm">
            <summary className="cursor-pointer py-2 text-ink-3 hover:text-ink">History ({p.costs.length})</summary>
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
          </details>
        ) : null}
      </div>
    </div>
  )
}
