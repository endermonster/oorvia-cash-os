'use client'

import { useEffect, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import MonthPicker from '@/components/shared/MonthPicker'
import OrderForm from '@/components/orders/OrderForm'
import OrderTable from '@/components/orders/OrderTable'
import ImportButton from '@/components/shared/ImportButton'
import { fmtINR } from '@/lib/pnl'

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function OrdersPage() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [month, setMonth] = useState(currentMonth)
  const [statusFilter, setStatusFilter] = useState('')
  const [modeFilter, setModeFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingOrder, setEditingOrder] = useState(null)

  const fetchOrders = async (m, status, mode) => {
    setLoading(true)
    const params = new URLSearchParams({ month: m })
    if (status) params.set('status', status)
    if (mode) params.set('paymentMode', mode)
    const res = await fetch(`/api/orders?${params}`)
    const data = await res.json()
    if (Array.isArray(data)) setOrders(data)
    else setError(data.error || 'Failed to load')
    setLoading(false)
  }

  useEffect(() => { fetchOrders(month, statusFilter, modeFilter) }, [month, statusFilter, modeFilter])

  const handleSaved = (saved) => {
    if (editingOrder) {
      setOrders((prev) => prev.map((o) => (o.id === saved.id ? saved : o)))
      setEditingOrder(null)
    } else {
      setOrders((prev) => [saved, ...prev])
      setShowForm(false)
    }
  }

  const handleEdit = (order) => { setEditingOrder(order); setShowForm(false) }
  const handleDelete = (id) => setOrders((prev) => prev.filter((o) => o.id !== id))

  // Stats
  const total = orders.length
  const delivered = orders.filter((o) => o.status === 'delivered').length
  const rtoCount = orders.filter((o) => o.status === 'rto').length
  const rtoRate = total > 0 ? ((rtoCount / total) * 100).toFixed(1) : '0.0'
  const grossRevenue = orders.reduce((s, o) => s + Number(o.order_value || 0), 0)

  const inputCls = 'rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Orders"
        subtitle={`${total} orders in ${month}`}
        actions={
          <>
            <MonthPicker monthStr={month} onChange={setMonth} />
            <ImportButton importType="orders" onDone={() => fetchOrders(month, statusFilter, modeFilter)} />
            <button
              onClick={() => { setShowForm(true); setEditingOrder(null) }}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
            >
              + Add Order
            </button>
          </>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard title="Total Orders" value={total} color="zinc" />
        <StatCard title="Delivered" value={delivered} color="green" />
        <StatCard title="RTO Count" value={rtoCount} color="red" />
        <StatCard title="RTO Rate" value={`${rtoRate}%`} color={parseFloat(rtoRate) > 20 ? 'red' : 'zinc'} subtitle="of total orders" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputCls}>
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="shipped">Shipped</option>
          <option value="delivered">Delivered</option>
          <option value="rto">RTO</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={modeFilter} onChange={(e) => setModeFilter(e.target.value)} className={inputCls}>
          <option value="">All Modes</option>
          <option value="prepaid">Prepaid</option>
          <option value="cod">COD</option>
        </select>
        <span className="text-sm text-zinc-500">Gross: <span className="text-zinc-200 font-medium">{fmtINR(grossRevenue)}</span></span>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : (
        <OrderTable orders={orders} onEdit={handleEdit} onDelete={handleDelete} />
      )}

      {/* Modals */}
      {showForm && (
        <OrderForm onSaved={handleSaved} onClose={() => setShowForm(false)} />
      )}
      {editingOrder && (
        <OrderForm
          initial={editingOrder}
          onSaved={handleSaved}
          onClose={() => setEditingOrder(null)}
        />
      )}
    </div>
  )
}
