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
    <div className="flex gap-1 border-b border-zinc-700 mb-5">
      {tabs.map(t => (
        <button key={t} onClick={() => onChange(t)}
          className={`px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${active === t ? 'border-blue-500 text-zinc-100' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}>
          {t}
        </button>
      ))}
    </div>
  )
}

function MarginBadge({ pct }) {
  const cls = pct >= 30 ? 'bg-green-900 text-green-300' : pct >= 10 ? 'bg-yellow-900 text-yellow-300' : 'bg-red-900 text-red-300'
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{pct.toFixed(1)}%</span>
}

function CostBreakdownTab({ costByHead }) {
  const entries = Object.entries(costByHead || {}).sort((a, b) => b[1] - a[1])
  const total   = entries.reduce((s, [, v]) => s + v, 0)
  if (entries.length === 0) return <p className="text-sm text-zinc-500 py-4">No cost data for this range.</p>
  return (
    <div className="rounded-xl border border-zinc-700 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-700 text-xs text-zinc-500 uppercase tracking-wider">
            <th className="px-4 py-3 text-left">Transaction Head</th>
            <th className="px-4 py-3 text-right">Taxable Amount</th>
            <th className="px-4 py-3 text-right">% of Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {entries.map(([head, amt]) => (
            <tr key={head} className="hover:bg-zinc-800/40">
              <td className="px-4 py-3 text-zinc-200">{head}</td>
              <td className="px-4 py-3 text-right text-zinc-100 font-medium">{fmtINR(amt)}</td>
              <td className="px-4 py-3 text-right text-zinc-400">{total > 0 ? ((amt / total) * 100).toFixed(1) : 0}%</td>
            </tr>
          ))}
          <tr className="border-t border-zinc-600 bg-zinc-800/60">
            <td className="px-4 py-3 text-zinc-300 font-semibold">Total Variable Costs</td>
            <td className="px-4 py-3 text-right text-zinc-100 font-bold">{fmtINR(total)}</td>
            <td className="px-4 py-3 text-right text-zinc-400">100%</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function BySkuTab({ bySku }) {
  if (!bySku?.length) return <p className="text-sm text-zinc-500 py-4">No SKU data. Add products and ensure line items have SKUs.</p>
  const hasMetaAttribution = bySku.some(s => s.meta_spend > 0)
  return (
    <div className="space-y-2">
      {!hasMetaAttribution && (
        <p className="text-xs text-yellow-500/80 px-1">
          No Meta spend is linked to SKUs yet — net margin excludes ad spend. Link campaigns on the Ad Spend page.
        </p>
      )}
      <div className="rounded-xl border border-zinc-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-700 text-xs text-zinc-500 uppercase tracking-wider">
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
          <tbody className="divide-y divide-zinc-800">
            {bySku.map(s => (
              <tr key={s.sku} className="hover:bg-zinc-800/40">
                <td className="px-4 py-3">
                  <p className="text-zinc-100">{s.name}</p>
                  <p className="text-xs text-zinc-500 font-mono">{s.sku}</p>
                </td>
                <td className="px-4 py-3 text-right text-zinc-300">{s.units}</td>
                <td className="px-4 py-3 text-right text-zinc-100 font-medium">{fmtINR(s.revenue_net)}</td>
                <td className="px-4 py-3 text-right text-red-400">{fmtINR(s.cogs)}</td>
                <td className={`px-4 py-3 text-right font-medium ${s.gross_profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtINR(s.gross_profit)}</td>
                <td className="px-4 py-3 text-right"><MarginBadge pct={s.margin_pct} /></td>
                <td className={`px-4 py-3 text-right font-medium ${s.net_profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtINR(s.net_profit)}</td>
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
  if (!data?.length) return <p className="text-sm text-zinc-500 py-4">No payment type data for this range.</p>
  return (
    <div className="rounded-xl border border-zinc-700 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-700 text-xs text-zinc-500 uppercase tracking-wider">
            <th className="px-4 py-3 text-left">Payment Type</th>
            <th className="px-4 py-3 text-right">Orders</th>
            <th className="px-4 py-3 text-right">Revenue (net)</th>
            <th className="px-4 py-3 text-right">Variable Costs</th>
            <th className="px-4 py-3 text-right">COGS</th>
            <th className="px-4 py-3 text-right">Contribution</th>
            <th className="px-4 py-3 text-right">Margin</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {data.map(pt => (
            <tr key={pt.type} className="hover:bg-zinc-800/40">
              <td className="px-4 py-3 text-zinc-100 font-medium">{PT_LABELS[pt.type] || pt.type}</td>
              <td className="px-4 py-3 text-right text-zinc-300">{pt.count}</td>
              <td className="px-4 py-3 text-right text-zinc-100">{fmtINR(pt.revenue_net)}</td>
              <td className="px-4 py-3 text-right text-red-400">{fmtINR(pt.variable_costs)}</td>
              <td className="px-4 py-3 text-right text-red-400">{fmtINR(pt.cogs)}</td>
              <td className={`px-4 py-3 text-right font-medium ${pt.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtINR(pt.net)}</td>
              <td className="px-4 py-3 text-right"><MarginBadge pct={pt.margin_pct} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ByMonthTab({ data }) {
  if (!data?.length) return <p className="text-sm text-zinc-500 py-4">No monthly data for this range.</p>
  const maxRev = Math.max(...data.map(m => m.revenue_net), 1)
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-700 text-xs text-zinc-500 uppercase tracking-wider">
              <th className="px-4 py-3 text-left">Month</th>
              <th className="px-4 py-3 text-right">Delivered</th>
              <th className="px-4 py-3 text-right">Revenue (net)</th>
              <th className="px-4 py-3 text-right">Variable Costs</th>
              <th className="px-4 py-3 text-right">Gross Contribution</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {data.map(m => {
              const gross = m.revenue_net - m.variable_costs
              return (
                <tr key={m.month} className="hover:bg-zinc-800/40">
                  <td className="px-4 py-3 text-zinc-100 font-medium">{fmtMonth(m.month)}</td>
                  <td className="px-4 py-3 text-right text-zinc-300">{m.count}</td>
                  <td className="px-4 py-3 text-right text-zinc-100">{fmtINR(m.revenue_net)}</td>
                  <td className="px-4 py-3 text-right text-red-400">{fmtINR(m.variable_costs)}</td>
                  <td className={`px-4 py-3 text-right font-medium ${gross >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtINR(gross)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {/* Mini bar chart */}
      <div className="flex items-end gap-2 h-24 px-1">
        {data.map(m => {
          const pct = (m.revenue_net / maxRev) * 100
          return (
            <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full rounded-t bg-blue-600/70" style={{ height: `${Math.max(pct, 2)}%` }} title={fmtINR(m.revenue_net)} />
              <span className="text-[10px] text-zinc-500">{fmtMonth(m.month).slice(0, 3)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Date range presets ────────────────────────────────────────────────────────

function getPreset(label) {
  const now  = new Date()
  const y    = now.getFullYear()
  const m    = now.getMonth()
  if (label === 'This Month')  return { from: new Date(y, m, 1).toISOString().slice(0, 10), to: new Date(y, m + 1, 0).toISOString().slice(0, 10) }
  if (label === 'Last Month')  return { from: new Date(y, m - 1, 1).toISOString().slice(0, 10), to: new Date(y, m, 0).toISOString().slice(0, 10) }
  if (label === 'Last 30 Days') {
    const to = now.toISOString().slice(0, 10)
    const from = new Date(now - 30 * 86400000).toISOString().slice(0, 10)
    return { from, to }
  }
  return null
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PnLPage() {
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

  const applyPreset = (label) => {
    const p = getPreset(label)
    if (!p) return
    setFrom(p.from); setTo(p.to); load(p.from, p.to)
  }

  const handleApply = () => load(from, to)

  const totalCosts = pnl ? pnl.variable_costs + pnl.cogs + pnl.fixed_costs_prorated + pnl.marketing_net : 0

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="P&L"
        subtitle="Net-of-GST profit & loss for any date range"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {['This Month','Last Month','Last 30 Days'].map(p => (
              <button key={p} onClick={() => applyPreset(p)}
                className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition">
                {p}
              </button>
            ))}
          </div>
        }
      />

      {/* Date range picker */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2">
          <label htmlFor="pnl-from" className="text-xs text-zinc-500">From</label>
          <input id="pnl-from" type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="bg-transparent text-sm text-zinc-100 focus:outline-none" />
          <span className="text-zinc-600">→</span>
          <label htmlFor="pnl-to" className="text-xs text-zinc-500">To</label>
          <input id="pnl-to" type="date" value={to} onChange={e => setTo(e.target.value)}
            className="bg-transparent text-sm text-zinc-100 focus:outline-none" />
        </div>
        <button onClick={handleApply} disabled={loading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition">
          {loading ? 'Loading…' : 'Apply'}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading && !pnl && <p className="text-sm text-zinc-500">Computing…</p>}

      {pnl && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard title="Revenue (net GST)"   value={fmtINR(pnl.revenue_net)}     subtitle={`${pnl.orders.delivered} delivered orders`} color="blue" />
            <StatCard title="Total Costs"          value={fmtINR(totalCosts)}           subtitle="variable + COGS + fixed + mktg"             color="red"  />
            <StatCard title="Net Profit"           value={fmtINR(pnl.net_profit)}       subtitle={`${pnl.margin_pct}% margin`}               color={pnl.net_profit >= 0 ? 'green' : 'red'} />
            <StatCard title="Input GST (ITC)"      value={fmtINR(pnl.total_itc)}        subtitle="claimable as ITC"                           color="zinc" />
          </div>

          {/* Secondary stats row */}
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-6 text-xs">
            {[
              { label: 'Variable Costs',  val: pnl.variable_costs         },
              { label: 'COGS',            val: pnl.cogs                   },
              { label: 'Fixed Costs',     val: pnl.fixed_costs_prorated   },
              { label: 'Marketing (net)', val: pnl.marketing_net          },
              { label: 'RTO Orders',      val: pnl.orders.rto             },
              { label: 'Pending Delivery',val: pnl.orders.active          },
            ].map(({ label, val }) => (
              <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
                <p className="text-zinc-500 mb-1">{label}</p>
                <p className="text-zinc-200 font-semibold">{typeof val === 'number' && val > 99 ? fmtINR(val) : val}</p>
              </div>
            ))}
          </div>

          {/* Waterfall */}
          <WaterfallCard pnl={pnl} />

          {/* Breakdown tabs */}
          <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-5">
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
              <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-center">
                <p className="text-zinc-600 mb-0.5">{label}</p>
                <p className="text-zinc-300 font-semibold text-base">{val}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
