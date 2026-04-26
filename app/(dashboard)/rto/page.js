'use client'

import { useEffect, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import MonthPicker from '@/components/shared/MonthPicker'
import { fmtINR } from '@/lib/pnl'

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function RTOPage() {
  const [month, setMonth] = useState(currentMonth)
  const [rtoOrders, setRtoOrders] = useState([])
  const [allCount, setAllCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [markingId, setMarkingId] = useState(null)

  const fetchData = async (m) => {
    setLoading(true)
    const [rtoRes, allRes] = await Promise.all([
      fetch(`/api/orders?month=${m}&status=rto`),
      fetch(`/api/orders?month=${m}`),
    ])
    const [rtoData, allData] = await Promise.all([rtoRes.json(), allRes.json()])
    if (Array.isArray(rtoData)) setRtoOrders(rtoData)
    if (Array.isArray(allData)) setAllCount(allData.length)
    setLoading(false)
  }

  useEffect(() => { fetchData(month) }, [month])

  const markDelivered = async (order) => {
    const key = order.shopify_order_name
    setMarkingId(key)
    await fetch(`/api/orders/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' }),
    })
    fetchData(month)
    setMarkingId(null)
  }

  const rtoCount = rtoOrders.length
  const rtoRate = allCount > 0 ? ((rtoCount / allCount) * 100).toFixed(1) : '0.0'
  const totalLoss = rtoOrders.reduce((s, o) => s + Number(o.order_value || 0), 0)

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="RTO Tracker"
        subtitle="Return to Origin orders — failed deliveries"
        actions={<MonthPicker monthStr={month} onChange={setMonth} />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard title="RTO Count" value={rtoCount} color="red" subtitle={`out of ${allCount} orders`} />
        <StatCard title="RTO Rate" value={`${rtoRate}%`} color={parseFloat(rtoRate) > 25 ? 'red' : 'zinc'} subtitle="of all orders this month" />
        <StatCard title="Total RTO Loss" value={fmtINR(totalLoss)} color="red" subtitle="lost revenue + return charges" />
      </div>

      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : (
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-800 text-xs font-semibold text-zinc-400 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Order Date</th>
                  <th className="px-4 py-3 text-left">Order ID</th>
                  <th className="px-4 py-3 text-left">Product</th>
                  <th className="px-4 py-3 text-right">Order Value</th>
                  <th className="px-4 py-3 text-right">RTO Charge</th>
                  <th className="px-4 py-3 text-right">Total Loss</th>
                  <th className="px-4 py-3 text-left">Mode</th>
                  <th className="px-4 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {rtoOrders.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-500">No RTO orders this month.</td></tr>
                ) : rtoOrders.map((o) => {
                  const isCOD = o.payment_type === 'cash_on_delivery'
                  const modeLabel = isCOD ? 'COD' : o.payment_type?.startsWith('prepaid') ? 'Prepaid' : (o.payment_type ?? '—').toUpperCase()
                  const key = o.shopify_order_name
                  return (
                    <tr key={key} className="hover:bg-zinc-800/60">
                      <td className="px-4 py-3 whitespace-nowrap text-zinc-300 text-xs">
                        {new Date(o.order_date).toLocaleDateString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-zinc-400 text-xs">{o.shopify_order_name || '—'}</td>
                      <td className="px-4 py-3 text-zinc-200">—</td>
                      <td className="px-4 py-3 text-right text-red-400 font-semibold line-through">{fmtINR(o.order_value)}</td>
                      <td className="px-4 py-3 text-right text-red-400">{fmtINR(0)}</td>
                      <td className="px-4 py-3 text-right text-red-400 font-bold">{fmtINR(o.order_value)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${isCOD ? 'bg-orange-900 text-orange-300' : 'bg-indigo-900 text-indigo-300'}`}>
                          {modeLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => markDelivered(o)}
                          disabled={markingId === key}
                          className="text-xs text-green-400 hover:text-green-200 px-2 py-1 rounded border border-green-800 hover:bg-zinc-700 disabled:opacity-40"
                        >
                          {markingId === key ? 'Saving…' : 'Mark Delivered'}
                        </button>
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
