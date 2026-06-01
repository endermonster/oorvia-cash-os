'use client'

import { useEffect, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import StatCard   from '@/components/shared/StatCard'
import WaterfallCard from '@/components/pnl/WaterfallCard'
import { fmtINR } from '@/lib/pnl'

// ── Date helpers ─────────────────────────────────────────────────────────────

function today()      { return new Date().toISOString().slice(0, 10) }
function monthStart() { return today().slice(0, 7) + '-01' }
function monthEnd()   {
  const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function fmtMonth(ym) { const [y, m] = ym.split('-'); return `${MONTHS[+m - 1]} ${y}` }

// ── Sub-components ────────────────────────────────────────────────────────────

function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 border-b border-slate-800 mb-5">
      {tabs.map(t => (
        <button key={t} onClick={() => onChange(t)}
          className={`px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px cursor-pointer ${active === t ? 'border-emerald-500 text-slate-100' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
          {t}
        </button>
      ))}
    </div>
  )
}

function MarginBadge({ pct }) {
  const cls = pct >= 30 ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/50' : pct >= 10 ? 'bg-yellow-950 text-yellow-400 border border-yellow-800/50' : 'bg-red-950 text-red-400 border border-red-800/50'
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{pct.toFixed(1)}%</span>
}

function CostBreakdownTab({ costByHead }) {
  const entries = Object.entries(costByHead || {}).sort((a, b) => b[1] - a[1])
  const total   = entries.reduce((s, [, v]) => s + v, 0)
  if (entries.length === 0) return <p className="text-sm text-slate-500 py-4">No cost data for this range.</p>
  return (
    <div className="rounded-xl border border-slate-800 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-xs text-slate-600 uppercase tracking-wider bg-slate-900/40">
            <th className="px-4 py-3 text-left">Transaction Head</th>
            <th className="px-4 py-3 text-right">Taxable Amount</th>
            <th className="px-4 py-3 text-right">% of Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">
          {entries.map(([head, amt]) => (
            <tr key={head} className="hover:bg-slate-800/30">
              <td className="px-4 py-3 text-slate-300">{head}</td>
              <td className="px-4 py-3 text-right text-slate-100 font-medium font-mono tabular-nums">{fmtINR(amt)}</td>
              <td className="px-4 py-3 text-right text-slate-500">{total > 0 ? ((amt / total) * 100).toFixed(1) : 0}%</td>
            </tr>
          ))}
          <tr className="border-t border-slate-700 bg-slate-800/40">
            <td className="px-4 py-3 text-slate-300 font-semibold">Total Variable Costs</td>
            <td className="px-4 py-3 text-right text-slate-100 font-bold font-mono tabular-nums">{fmtINR(total)}</td>
            <td className="px-4 py-3 text-right text-slate-500">100%</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function BySkuTab({ bySku }) {
  if (!bySku?.length) return <p className="text-sm text-slate-500 py-4">No SKU data. Add products and ensure line items have SKUs.</p>
  const hasMetaAttribution = bySku.some(s => s.meta_spend > 0)
  return (
    <div className="space-y-2">
      {!hasMetaAttribution && (
        <p className="text-xs text-yellow-500/80 px-1">
          No Meta spend is linked to SKUs yet — net margin excludes ad spend. Link campaigns on the Ad Spend page.
        </p>
      )}
      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs text-slate-600 uppercase tracking-wider bg-slate-900/40">
              <th className="px-4 py-3 text-left">SKU / Product</th>
              <th className="px-4 py-3 text-right">Units</th>
              <th className="px-4 py-3 text-right">Revenue (net)</th>
              <th className="px-4 py-3 text-right">COGS</th>
              <th className="px-4 py-3 text-right">Gross Profit</th>
              <th className="px-4 py-3 text-right">Gross Margin</th>
              <th className="px-4 py-3 text-right">Net Profit</th>
              <th className="px-4 py-3 text-right">Net Margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {bySku.map(s => (
              <tr key={s.sku} className="hover:bg-slate-800/30">
                <td className="px-4 py-3">
                  <p className="text-slate-100">{s.name}</p>
                  <p className="text-xs text-slate-600 font-mono">{s.sku}</p>
                </td>
                <td className="px-4 py-3 text-right text-slate-400">{s.units}</td>
                <td className="px-4 py-3 text-right text-slate-100 font-medium font-mono tabular-nums">{fmtINR(s.revenue_net)}</td>
                <td className="px-4 py-3 text-right text-red-400 font-mono tabular-nums">{fmtINR(s.cogs)}</td>
                <td className={`px-4 py-3 text-right font-medium font-mono tabular-nums ${s.gross_profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(s.gross_profit)}</td>
                <td className="px-4 py-3 text-right"><MarginBadge pct={s.margin_pct} /></td>
                <td className={`px-4 py-3 text-right font-medium font-mono tabular-nums ${s.net_profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(s.net_profit)}</td>
                <td className="px-4 py-3 text-right"><MarginBadge pct={s.net_margin_pct} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const PT_LABELS = { cash_on_delivery: 'COD', prepaid_cashfree: 'Cashfree', prepaid_razorpay: 'Razorpay', unknown: 'Unknown' }

function ByPaymentTypeTab({ data }) {
  if (!data?.length) return <p className="text-sm text-slate-500 py-4">No payment type data for this range.</p>
  return (
    <div className="rounded-xl border border-slate-800 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-xs text-slate-600 uppercase tracking-wider bg-slate-900/40">
            <th className="px-4 py-3 text-left">Payment Type</th>
            <th className="px-4 py-3 text-right">Orders</th>
            <th className="px-4 py-3 text-right">Revenue (net)</th>
            <th className="px-4 py-3 text-right">Variable Costs</th>
            <th className="px-4 py-3 text-right">COGS</th>
            <th className="px-4 py-3 text-right">Contribution</th>
            <th className="px-4 py-3 text-right">Margin</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">
          {data.map(pt => (
            <tr key={pt.type} className="hover:bg-slate-800/30">
              <td className="px-4 py-3 text-slate-100 font-medium">{PT_LABELS[pt.type] || pt.type}</td>
              <td className="px-4 py-3 text-right text-slate-400 tabular-nums">{pt.count}</td>
              <td className="px-4 py-3 text-right text-slate-100 font-mono tabular-nums">{fmtINR(pt.revenue_net)}</td>
              <td className="px-4 py-3 text-right text-red-400 font-mono tabular-nums">{fmtINR(pt.variable_costs)}</td>
              <td className="px-4 py-3 text-right text-red-400 font-mono tabular-nums">{fmtINR(pt.cogs)}</td>
              <td className={`px-4 py-3 text-right font-medium font-mono tabular-nums ${pt.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(pt.net)}</td>
              <td className="px-4 py-3 text-right"><MarginBadge pct={pt.margin_pct} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ByMonthTab({ data }) {
  if (!data?.length) return <p className="text-sm text-slate-500 py-4">No monthly data for this range.</p>
  const maxRev = Math.max(...data.map(m => m.revenue_net), 1)
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs text-slate-600 uppercase tracking-wider bg-slate-900/40">
              <th className="px-4 py-3 text-left">Month</th>
              <th className="px-4 py-3 text-right">Delivered</th>
              <th className="px-4 py-3 text-right">Revenue (net)</th>
              <th className="px-4 py-3 text-right">Variable Costs</th>
              <th className="px-4 py-3 text-right">Gross Contribution</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {data.map(m => {
              const gross = m.revenue_net - m.variable_costs
              return (
                <tr key={m.month} className="hover:bg-slate-800/30">
                  <td className="px-4 py-3 text-slate-100 font-medium">{fmtMonth(m.month)}</td>
                  <td className="px-4 py-3 text-right text-slate-400 tabular-nums">{m.count}</td>
                  <td className="px-4 py-3 text-right text-slate-100 font-mono tabular-nums">{fmtINR(m.revenue_net)}</td>
                  <td className="px-4 py-3 text-right text-red-400 font-mono tabular-nums">{fmtINR(m.variable_costs)}</td>
                  <td className={`px-4 py-3 text-right font-medium font-mono tabular-nums ${gross >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(gross)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {/* Mini bar chart */}
      <div className="flex items-end gap-1.5 h-20 px-1">
        {data.map(m => {
          const pct = (m.revenue_net / maxRev) * 100
          return (
            <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full rounded-sm bg-emerald-600/60" style={{ height: `${Math.max(pct, 2)}%` }} title={fmtINR(m.revenue_net)} />
              <span className="text-[10px] text-slate-600">{fmtMonth(m.month).slice(0, 3)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const now = new Date()
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const YEAR_OPTIONS = Array.from({ length: now.getFullYear() - 2022 + 1 }, (_, i) => 2022 + i)

function monthRange(year, month) {
  const pad = n => String(n).padStart(2, '0')
  const lastDay = new Date(year, month, 0).getDate()
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(lastDay)}` }
}

export default function PnLPage() {
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1)
  const [selYear,  setSelYear]  = useState(now.getFullYear())
  const [from, setFrom] = useState(monthStart)
  const [to,   setTo]   = useState(monthEnd)
  const [pnl,  setPnl]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [tab, setTab]         = useState('Cost Breakdown')

  const load = async (f, t) => {
    setLoading(true); setError(null)
    try {
      const res  = await fetch(`/api/pnl?from=${f}&to=${t}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed'); setLoading(false); return }
      setPnl(data); setLoading(false)
    } catch (e) {
      setError('Failed to load P&L data'); setLoading(false)
    }
  }

  useEffect(() => { load(from, to) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const applyMonthYear = (month, year) => {
    const { from: f, to: t } = monthRange(year, month)
    setFrom(f); setTo(t); load(f, t)
  }

  const handleMonthChange = (e) => {
    const m = Number(e.target.value)
    setSelMonth(m); applyMonthYear(m, selYear)
  }

  const handleYearChange = (e) => {
    const y = Number(e.target.value)
    setSelYear(y); applyMonthYear(selMonth, y)
  }

  const handleApply = () => load(from, to)

  const totalCosts = pnl ? pnl.variable_costs + pnl.cogs + pnl.fixed_costs_prorated + pnl.marketing_net : 0

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="P&L"
        subtitle="Net-of-GST profit & loss for any date range"
        actions={
          <div className="flex items-center gap-2">
            <select value={selMonth} onChange={handleMonthChange}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 focus:outline-none cursor-pointer">
              {MONTH_NAMES.map((name, i) => (
                <option key={i + 1} value={i + 1}>{name}</option>
              ))}
            </select>
            <select value={selYear} onChange={handleYearChange}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 focus:outline-none cursor-pointer">
              {YEAR_OPTIONS.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        }
      />

      {/* Date range picker */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-900/60 px-3 py-2">
          <label htmlFor="pnl-from" className="text-xs text-slate-600">From</label>
          <input id="pnl-from" type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="bg-transparent text-sm text-slate-200 focus:outline-none" />
          <span className="text-slate-700">→</span>
          <label htmlFor="pnl-to" className="text-xs text-slate-600">To</label>
          <input id="pnl-to" type="date" value={to} onChange={e => setTo(e.target.value)}
            className="bg-transparent text-sm text-slate-200 focus:outline-none" />
        </div>
        <button onClick={handleApply} disabled={loading}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors cursor-pointer">
          {loading ? 'Loading…' : 'Apply'}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading && !pnl && <p className="text-sm text-slate-500">Computing…</p>}

      {pnl && (
        <>
          {/* Gross revenue hero card */}
          <div className="rounded-xl border border-slate-700/60 bg-slate-900/80 px-6 py-5">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1.5">Gross Revenue (incl. GST)</p>
            <p className="text-4xl font-bold text-white font-mono tabular-nums">{fmtINR(pnl.revenue_gross)}</p>
            <p className="text-xs text-slate-600 mt-2">
              {pnl.orders.delivered} delivered orders · GST collected: {fmtINR(pnl.revenue_gross - pnl.revenue_net)}
            </p>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard title="Revenue (net GST)"   value={fmtINR(pnl.revenue_net)}     subtitle={`${pnl.orders.delivered} delivered orders`} color="blue" />
            <StatCard title="Total Costs"          value={fmtINR(totalCosts)}           subtitle="variable + COGS + fixed + mktg"             color="red"  />
            <StatCard title="Net Profit"           value={fmtINR(pnl.net_profit)}       subtitle={`${pnl.margin_pct}% margin`}               color={pnl.net_profit >= 0 ? 'green' : 'red'} />
            <StatCard title="Input GST (ITC)"      value={fmtINR(pnl.total_itc)}        subtitle="claimable as ITC"                           color="zinc" />
          </div>

          {/* Secondary stats row */}
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6 text-xs">
            {[
              { label: 'Variable Costs',  val: pnl.variable_costs         },
              { label: 'COGS',            val: pnl.cogs                   },
              { label: 'Fixed Costs',     val: pnl.fixed_costs_prorated   },
              { label: 'Marketing (net)', val: pnl.marketing_net          },
              { label: 'RTO Orders',      val: pnl.orders.rto             },
              { label: 'Pending Delivery',val: pnl.orders.active          },
            ].map(({ label, val }) => (
              <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
                <p className="text-slate-600 mb-1">{label}</p>
                <p className="text-slate-300 font-semibold font-mono tabular-nums">{typeof val === 'number' && val > 99 ? fmtINR(val) : val}</p>
              </div>
            ))}
          </div>

          {/* Waterfall */}
          <WaterfallCard pnl={pnl} />

          {/* Breakdown tabs */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <Tabs tabs={['Cost Breakdown','By SKU','By Payment Type','By Month']} active={tab} onChange={setTab} />
            {tab === 'Cost Breakdown'    && <CostBreakdownTab   costByHead={pnl.cost_by_head} />}
            {tab === 'By SKU'            && <BySkuTab           bySku={pnl.by_sku} />}
            {tab === 'By Payment Type'   && <ByPaymentTypeTab   data={pnl.by_payment_type} />}
            {tab === 'By Month'          && <ByMonthTab         data={pnl.by_month} />}
          </div>

          {/* Order counts footer */}
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6 text-xs">
            {[
              { label: 'Total Orders',   val: pnl.orders.total     },
              { label: 'Delivered',      val: pnl.orders.delivered },
              { label: 'RTO',            val: pnl.orders.rto       },
              { label: 'Active',         val: pnl.orders.active    },
              { label: 'COD',            val: pnl.orders.cod       },
              { label: 'Prepaid',        val: pnl.orders.prepaid   },
            ].map(({ label, val }) => (
              <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/30 px-3 py-2 text-center">
                <p className="text-slate-600 mb-0.5">{label}</p>
                <p className="text-slate-400 font-semibold text-base tabular-nums">{val}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
