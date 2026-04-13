'use client'

import { useEffect, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import MonthPicker from '@/components/shared/MonthPicker'
import WaterfallCard from '@/components/pnl/WaterfallCard'
import MonthlyBarChart from '@/components/pnl/MonthlyBarChart'
import { fmtINR } from '@/lib/pnl'

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Fetch last 6 months of cached P&L for the MoM chart
async function fetchHistory() {
  const now = new Date()
  const results = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const res = await fetch(`/api/pnl?month=${m}`)
    const data = await res.json()
    if (data) results.push(data)
  }
  return results
}

export default function PnLPage() {
  const [month, setMonth] = useState(currentMonth)
  const [pnl, setPnl] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [recomputing, setRecomputing] = useState(false)
  const [error, setError] = useState(null)

  const loadPnL = async (m) => {
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/pnl?month=${m}`)
    const data = await res.json()
    setPnl(data)
    setLoading(false)
  }

  const recompute = async () => {
    setRecomputing(true)
    setError(null)
    const res = await fetch('/api/pnl/recompute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month }),
    })
    const data = await res.json()
    if (res.ok) {
      setPnl(data)
      // Refresh history too
      fetchHistory().then(setHistory)
    } else {
      setError(data.error || 'Recompute failed')
    }
    setRecomputing(false)
  }

  useEffect(() => {
    loadPnL(month)
  }, [month])

  useEffect(() => {
    fetchHistory().then(setHistory)
  }, [])

  const totalDeductions = pnl
    ? (pnl.total_checkout_fees || 0) +
      (pnl.total_payment_gw_fees || 0) +
      (pnl.total_3pl_charges || 0) +
      (pnl.total_rto_charges || 0) +
      (pnl.total_ad_spend || 0) +
      (pnl.total_cogs || 0)
    : 0

  const netProfit = pnl?.net_profit || 0
  const actualRevenue = pnl?.actual_revenue || 0
  const marginPct = actualRevenue > 0 ? ((netProfit / actualRevenue) * 100).toFixed(1) : '0.0'

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="P&L Dashboard"
        subtitle="Monthly profit & loss breakdown"
        actions={
          <>
            <MonthPicker monthStr={month} onChange={setMonth} />
            <button
              onClick={recompute}
              disabled={recomputing}
              className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
            >
              {recomputing ? 'Computing…' : 'Recompute'}
            </button>
          </>
        }
      />

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : !pnl ? (
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900 px-6 py-12 text-center">
          <p className="text-zinc-400 text-sm mb-3">No P&L data for this month yet.</p>
          <button
            onClick={recompute}
            disabled={recomputing}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {recomputing ? 'Computing…' : 'Compute Now'}
          </button>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              title="Gross Revenue"
              value={fmtINR(pnl.gross_revenue || 0)}
              subtitle={`${pnl.order_count || 0} orders`}
              color="blue"
            />
            <StatCard
              title="Actual Revenue"
              value={fmtINR(pnl.actual_revenue || 0)}
              subtitle={pnl.rto_count ? `−${fmtINR(pnl.rto_revenue_lost)} RTO` : 'post-RTO'}
              color="zinc"
            />
            <StatCard
              title="Total Deductions"
              value={fmtINR(totalDeductions)}
              subtitle="fees + ads + COGS"
              color="red"
            />
            <StatCard
              title="Net Profit"
              value={fmtINR(netProfit)}
              subtitle={`${marginPct}% margin`}
              color={netProfit >= 0 ? 'green' : 'red'}
            />
          </div>

          {/* Secondary stats */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-xs">
            {[
              { label: 'Ad Spend', val: pnl.total_ad_spend },
              { label: '3PL Charges', val: pnl.total_3pl_charges },
              { label: 'RTO Loss', val: (pnl.rto_revenue_lost || 0) + (pnl.total_rto_charges || 0) },
              { label: 'COGS', val: pnl.total_cogs },
            ].map(({ label, val }) => (
              <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
                <p className="text-zinc-500 mb-1">{label}</p>
                <p className="text-zinc-200 font-semibold">{fmtINR(val || 0)}</p>
              </div>
            ))}
          </div>

          {/* Waterfall */}
          <WaterfallCard pnl={pnl} />

          {/* P&L details */}
          <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-5">
            <h3 className="text-sm font-semibold text-zinc-100 mb-3">Order Breakdown</h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
              {[
                { label: 'Total Orders', val: pnl.order_count },
                { label: 'Delivered', val: (pnl.order_count || 0) - (pnl.rto_count || 0) - 0 },
                { label: 'RTO Orders', val: pnl.rto_count },
                { label: 'RTO Rate', val: pnl.order_count > 0 ? `${((pnl.rto_count / pnl.order_count) * 100).toFixed(1)}%` : '—' },
                { label: 'Prepaid Orders', val: pnl.prepaid_order_count },
                { label: 'COD Orders', val: pnl.cod_order_count },
                { label: 'Checkout Fees', val: fmtINR(pnl.total_checkout_fees || 0) },
                { label: 'Payment GW', val: fmtINR(pnl.total_payment_gw_fees || 0) },
              ].map(({ label, val }) => (
                <div key={label}>
                  <p className="text-zinc-500 text-xs">{label}</p>
                  <p className="text-zinc-200 font-medium">{val}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-zinc-600 mt-4">
              Last computed: {pnl.computed_at ? new Date(pnl.computed_at).toLocaleString('en-IN') : '—'}
            </p>
          </div>
        </>
      )}

      {/* MoM chart always shown */}
      <MonthlyBarChart history={history} />
    </div>
  )
}
