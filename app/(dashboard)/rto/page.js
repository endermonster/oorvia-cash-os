'use client'

import { useEffect, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import MonthPicker from '@/components/shared/MonthPicker'
import { fmtINR } from '@/lib/pnl'
import { currentMonth, fmtDate, today } from '@/lib/dates'

export default function RTOPage() {
  const [month, setMonth] = useState(currentMonth)
  const [rtoOrders, setRtoOrders] = useState([])
  const [costsMap, setCostsMap] = useState({}) // shopify_order_name → total RTO cost
  const [allCount, setAllCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [markingId, setMarkingId] = useState(null)
  const [confirmingId, setConfirmingId] = useState(null) // order awaiting a delivery date
  const [deliveredOn, setDeliveredOn] = useState(today)
  const [markError, setMarkError] = useState(null)

  const fetchData = async (m) => {
    setLoading(true)
    const [rtoRes, allRes] = await Promise.all([
      fetch(`/api/orders?month=${m}&status=rto`),
      fetch(`/api/orders?month=${m}`),
    ])
    const [rtoData, allData] = await Promise.all([rtoRes.json(), allRes.json()])

    const rtoOrders = Array.isArray(rtoData) ? rtoData : []
    if (Array.isArray(rtoData)) setRtoOrders(rtoData)
    if (Array.isArray(allData)) setAllCount(allData.length)

    // Fetch order_costs for RTO orders to compute actual charges
    if (rtoOrders.length > 0) {
      const names = rtoOrders.map((o) => o.shopify_order_name).filter(Boolean)
      const params = new URLSearchParams({ names: names.join(',') })
      const costsRes = await fetch(`/api/rto-costs?${params}`)
      if (costsRes.ok) {
        const costsData = await costsRes.json()
        setCostsMap(costsData)
      }
    } else {
      setCostsMap({})
    }

    setLoading(false)
  }

  useEffect(() => { fetchData(month) }, [month])

  const openConfirm = (key) => {
    setConfirmingId(key)
    setDeliveredOn(today())
    setMarkError(null)
  }

  // delivered_at drives which P&L month and GST return this order lands in,
  // so it is asked for rather than assumed.
  const markDelivered = async (key) => {
    setMarkingId(key)
    setMarkError(null)
    const res = await fetch(`/api/orders/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered', delivered_at: deliveredOn }),
    })
    setMarkingId(null)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setMarkError(d.error || 'Could not update this order.')
      return
    }
    setConfirmingId(null)
    fetchData(month)
  }

  const rtoCount    = rtoOrders.length
  const rtoRate     = allCount > 0 ? ((rtoCount / allCount) * 100).toFixed(1) : '0.0'
  const totalLostRevenue = rtoOrders.reduce((s, o) => s + Number(o.order_value || 0), 0)
  const totalRtoCosts    = Object.values(costsMap).reduce((s, v) => s + v, 0)
  const totalRtoLoss     = totalLostRevenue + totalRtoCosts

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="RTO Tracker"
        subtitle="Return to Origin orders — failed deliveries"
        actions={<MonthPicker monthStr={month} onChange={setMonth} />}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard title="RTO Count"        value={rtoCount}            color="red"  subtitle={`out of ${allCount} orders`} />
        <StatCard title="RTO Rate"         value={`${rtoRate}%`}       color={parseFloat(rtoRate) > 25 ? 'red' : 'zinc'} subtitle="of all orders this month" />
        <StatCard title="Fulfilment Costs" value={fmtINR(totalRtoCosts)}    color="red"  subtitle="shipping + fees paid out" />
        <StatCard title="Total RTO Loss"   value={fmtINR(totalRtoLoss)}     color="red"  subtitle="lost revenue + fulfilment costs" />
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="rounded-2xl border border-slate-700 bg-slate-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Order Date</th>
                  <th className="px-4 py-3 text-left">Order ID</th>
                  <th className="px-4 py-3 text-left">Mode</th>
                  <th className="px-4 py-3 text-right">Lost Revenue</th>
                  <th className="px-4 py-3 text-right">Fulfilment Costs</th>
                  <th className="px-4 py-3 text-right">Total Loss</th>
                  <th className="px-4 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rtoOrders.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No RTO orders this month.</td></tr>
                ) : rtoOrders.map((o) => {
                  const isCOD     = o.payment_type === 'cash_on_delivery'
                  const modeLabel = isCOD ? 'COD' : o.payment_type?.startsWith('prepaid') ? 'Prepaid' : (o.payment_type ?? '—').toUpperCase()
                  const key       = o.shopify_order_name
                  const rtoCost   = costsMap[key] ?? 0
                  const totalLoss = Number(o.order_value || 0) + rtoCost
                  return (
                    <tr key={key} className="hover:bg-slate-800/60">
                      <td className="px-4 py-3 whitespace-nowrap text-slate-300 text-xs">
                        {fmtDate(o.order_date)}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{key || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${isCOD ? 'bg-orange-900 text-orange-300' : 'bg-indigo-900 text-indigo-300'}`}>
                          {modeLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-red-400 font-semibold line-through">{fmtINR(o.order_value)}</td>
                      <td className="px-4 py-3 text-right text-orange-400 font-semibold">{rtoCost > 0 ? fmtINR(rtoCost) : '—'}</td>
                      <td className="px-4 py-3 text-right text-red-400 font-bold">{fmtINR(totalLoss)}</td>
                      <td className="px-4 py-3">
                        {confirmingId === key ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <label className="sr-only" htmlFor={`delivered-${key}`}>Delivery date</label>
                            <input
                              id={`delivered-${key}`}
                              type="date"
                              autoFocus
                              value={deliveredOn}
                              max={today()}
                              onChange={(e) => setDeliveredOn(e.target.value)}
                              className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                            <button
                              onClick={() => markDelivered(key)}
                              disabled={markingId === key || !deliveredOn}
                              className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500 disabled:opacity-40 cursor-pointer"
                            >
                              {markingId === key ? 'Saving…' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => setConfirmingId(null)}
                              className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => openConfirm(key)}
                            className="text-xs text-emerald-400 hover:text-emerald-200 px-2 py-1 rounded border border-emerald-800 hover:bg-slate-700 cursor-pointer"
                          >
                            Mark Delivered
                          </button>
                        )}
                        {markError && confirmingId === key && (
                          <p className="mt-1 text-xs text-red-400">{markError}</p>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
