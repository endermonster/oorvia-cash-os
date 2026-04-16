'use client'

import { useState } from 'react'
import { computeOrderFees, computeOrderNetProfit, fmtINR } from '@/lib/pnl'

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500'

const defaultForm = {
  shopify_order_id: '',
  order_date:       new Date().toISOString().slice(0, 10),
  payment_mode:     'prepaid',
  status:           'pending',
  order_value:      '',
  checkout_fee:     '',
  cashfree_fee:     '',
  order_mgmt_fee:   '',
  platform_fee:     '',
  cod_fee:          '',
  meta_ad_spend_attributed: '',
  notes:            '',
}

export default function OrderForm({ onSaved, onClose, initial }) {
  const [form, setForm]     = useState(() => initial ? { ...defaultForm, ...initial } : defaultForm)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState(null)
  const isEdit = Boolean(initial?.id)

  // Auto-compute platform fees when order_value or payment_mode changes
  const handleChange = (e) => {
    const { name, value } = e.target
    setForm((prev) => {
      const next = { ...prev, [name]: value }
      if (name === 'order_value' || name === 'payment_mode') {
        const price = parseFloat(name === 'order_value' ? value : prev.order_value) || 0
        const mode  = name === 'payment_mode' ? value : prev.payment_mode
        const fees  = computeOrderFees(price, mode)
        next.checkout_fee = fees.checkout.toString()
        next.cashfree_fee = fees.cashfreeFee.toString()
      }
      return next
    })
  }

  // Live net profit preview
  const previewOrder = {
    status:                   form.status,
    order_value:              parseFloat(form.order_value) || 0,
    payment_mode:             form.payment_mode,
    checkout_fee:             parseFloat(form.checkout_fee) || 0,
    cashfree_fee:             parseFloat(form.cashfree_fee) || 0,
    order_mgmt_fee:           parseFloat(form.order_mgmt_fee) || 0,
    platform_fee:             parseFloat(form.platform_fee) || 0,
    cod_fee:                  parseFloat(form.cod_fee) || 0,
    meta_ad_spend_attributed: parseFloat(form.meta_ad_spend_attributed) || 0,
  }
  const netProfit  = computeOrderNetProfit(previewOrder)
  const isPositive = netProfit >= 0

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const payload = {
      shopify_order_id:         form.shopify_order_id || null,
      order_date:               form.order_date,
      payment_mode:             form.payment_mode,
      status:                   form.status,
      order_value:              parseFloat(form.order_value),
      checkout_fee:             parseFloat(form.checkout_fee) || 0,
      cashfree_fee:             parseFloat(form.cashfree_fee) || 0,
      order_mgmt_fee:           parseFloat(form.order_mgmt_fee) || 0,
      platform_fee:             parseFloat(form.platform_fee) || 0,
      cod_fee:                  parseFloat(form.cod_fee) || 0,
      meta_ad_spend_attributed: parseFloat(form.meta_ad_spend_attributed) || null,
      notes:                    form.notes || null,
    }

    const url    = isEdit ? `/api/orders/${initial.id}` : '/api/orders'
    const method = isEdit ? 'PATCH' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const d = await res.json()
      setError(d.error || 'Something went wrong')
      setLoading(false)
      return
    }

    const saved = await res.json()
    onSaved(saved)
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl my-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-zinc-100">{isEdit ? 'Edit Order' : 'Add Order'}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 transition-colors">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="2" y1="2" x2="14" y2="14" /><line x1="14" y1="2" x2="2" y2="14" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Row 1: date, mode, status */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Order Date</label>
              <input type="date" name="order_date" value={form.order_date} onChange={handleChange} required className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Payment Mode</label>
              <select name="payment_mode" value={form.payment_mode} onChange={handleChange} className={inputCls}>
                <option value="prepaid">Prepaid</option>
                <option value="cod">COD</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Status</label>
              <select name="status" value={form.status} onChange={handleChange} className={inputCls}>
                <option value="pending">Pending</option>
                <option value="shipped">Shipped</option>
                <option value="delivered">Delivered</option>
                <option value="rto">RTO</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {/* Row 2: shopify id + order value */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 mb-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Shopify Order ID</label>
              <input type="text" name="shopify_order_id" value={form.shopify_order_id} onChange={handleChange} placeholder="e.g. #OV31139290" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Order Value ₹</label>
              <input type="number" name="order_value" value={form.order_value} onChange={handleChange} placeholder="0" min="0" step="0.01" required className={inputCls} />
            </div>
          </div>

          {/* Platform fees */}
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Platform Fees (auto-computed — override if needed)</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 mb-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Checkout Fee ₹ (2%+GST)</label>
              <input type="number" name="checkout_fee" value={form.checkout_fee} onChange={handleChange} placeholder="0" min="0" step="0.01" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Cashfree Fee ₹ {form.payment_mode === 'cod' ? '(N/A for COD)' : '(2.5%)'}
              </label>
              <input
                type="number"
                name="cashfree_fee"
                value={form.cashfree_fee}
                onChange={handleChange}
                placeholder="0"
                min="0"
                step="0.01"
                disabled={form.payment_mode === 'cod'}
                className={inputCls + (form.payment_mode === 'cod' ? ' opacity-40' : '')}
              />
            </div>
          </div>

          {/* vFulfill fees */}
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">vFulfill Charges</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Order Mgmt Fee ₹</label>
              <input type="number" name="order_mgmt_fee" value={form.order_mgmt_fee} onChange={handleChange} placeholder="0" min="0" step="0.01" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Platform Fee ₹</label>
              <input type="number" name="platform_fee" value={form.platform_fee} onChange={handleChange} placeholder="0" min="0" step="0.01" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                COD Fee ₹ {form.payment_mode === 'prepaid' ? '(N/A for prepaid)' : ''}
              </label>
              <input
                type="number"
                name="cod_fee"
                value={form.cod_fee}
                onChange={handleChange}
                placeholder="0"
                min="0"
                step="0.01"
                disabled={form.payment_mode === 'prepaid'}
                className={inputCls + (form.payment_mode === 'prepaid' ? ' opacity-40' : '')}
              />
            </div>
          </div>

          {/* Meta + notes */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 mb-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Meta Ad Spend Attributed ₹</label>
              <input type="number" name="meta_ad_spend_attributed" value={form.meta_ad_spend_attributed} onChange={handleChange} placeholder="Optional" min="0" step="0.01" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Notes</label>
              <input type="text" name="notes" value={form.notes} onChange={handleChange} placeholder="Optional" className={inputCls} />
            </div>
          </div>

          {/* Live P&L preview */}
          <div className={`mb-4 rounded-xl border px-4 py-3 ${isPositive ? 'border-green-800 bg-green-900/20' : 'border-red-800 bg-red-900/20'}`}>
            <span className="text-xs text-zinc-500">Net profit on this order: </span>
            <span className={`text-sm font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
              {isPositive ? '+' : ''}{fmtINR(netProfit)}
            </span>
          </div>

          {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
              {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
