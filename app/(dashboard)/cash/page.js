'use client'

import { useEffect, useState } from 'react'
import { fmtINR } from '@/lib/pnl'
import { today } from '@/lib/dates'

const inputCls =
  'rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500'

function SectionHeading({ children }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
      {children}
    </p>
  )
}

export default function CashPage() {
  const [data,          setData]          = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [editingWallet, setEditingWallet] = useState(null) // 'bank' | 'cashfree'
  const [balanceInput,  setBalanceInput]  = useState('')
  const [saving,        setSaving]        = useState(false)

  const fetchData = async () => {
    setLoading(true)
    const res  = await fetch('/api/cash')
    const json = await res.json()
    if (!json.error) setData(json)
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  const handleSetBalance = async (wallet) => {
    setSaving(true)
    await fetch('/api/wallet-transactions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet,
        type:   'snapshot',
        amount: parseFloat(balanceInput) || 0,
        date:   today(),
        note:   'Manual balance snapshot',
      }),
    })
    setEditingWallet(null)
    setBalanceInput('')
    setSaving(false)
    fetchData()
  }

  const openEdit = (wallet, currentVal) => {
    setEditingWallet(wallet)
    setBalanceInput(String(currentVal || ''))
  }

  if (loading) return <p className="text-sm text-slate-400 p-6">Loading…</p>
  if (!data)   return null

  const { wallets, total_liquid, cod_float, cod_active_count, partners, loans } = data

  const partnerTotal  = partners.reduce((s, p) => s + p.outstanding, 0)
  const loanTotalDue  = loans.reduce((s, l) => s + l.total_due, 0)

  return (
    <div className="max-w-5xl mx-auto space-y-7">

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Cash Position</h1>
          <p className="text-sm text-slate-500 mt-0.5">As of {data.today}</p>
        </div>
        <button
          onClick={fetchData}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          Refresh
        </button>
      </div>

      {/* ── Liquid Cash ── */}
      <div>
        <SectionHeading>Liquid Cash</SectionHeading>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">

          {/* Bank */}
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4 flex flex-col gap-1">
            <p className="text-xs text-slate-500">Bank Balance</p>
            <p className="text-2xl font-semibold tabular-nums text-slate-100">{fmtINR(wallets.bank)}</p>
            {wallets.bank_as_of
              ? <p className="text-[10px] text-slate-600">as of {wallets.bank_as_of}</p>
              : <p className="text-[10px] text-slate-600">not set</p>
            }
            {editingWallet === 'bank' ? (
              <div className="mt-2 flex gap-1">
                <input
                  autoFocus
                  type="number"
                  value={balanceInput}
                  onChange={e => setBalanceInput(e.target.value)}
                  placeholder="0"
                  className={`flex-1 min-w-0 ${inputCls}`}
                />
                <button
                  disabled={saving}
                  onClick={() => handleSetBalance('bank')}
                  className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  Set
                </button>
                <button
                  onClick={() => setEditingWallet(null)}
                  className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => openEdit('bank', wallets.bank)}
                className="mt-1 self-start text-[10px] text-emerald-500 hover:text-emerald-400"
              >
                Update balance
              </button>
            )}
          </div>

          {/* vFulfill */}
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4 flex flex-col gap-1">
            <p className="text-xs text-slate-500">vFulfill Wallet</p>
            <p className={`text-2xl font-semibold tabular-nums ${wallets.vfulfill >= 0 ? 'text-slate-100' : 'text-red-400'}`}>
              {fmtINR(wallets.vfulfill)}
            </p>
            <p className="text-[10px] text-slate-600">auto-computed from imports</p>
          </div>

          {/* Cashfree */}
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4 flex flex-col gap-1">
            <p className="text-xs text-slate-500">Cashfree Pending</p>
            <p className="text-2xl font-semibold tabular-nums text-slate-100">{fmtINR(wallets.cashfree)}</p>
            {wallets.cashfree_as_of
              ? <p className="text-[10px] text-slate-600">as of {wallets.cashfree_as_of}</p>
              : <p className="text-[10px] text-slate-600">not set</p>
            }
            {editingWallet === 'cashfree' ? (
              <div className="mt-2 flex gap-1">
                <input
                  autoFocus
                  type="number"
                  value={balanceInput}
                  onChange={e => setBalanceInput(e.target.value)}
                  placeholder="0"
                  className={`flex-1 min-w-0 ${inputCls}`}
                />
                <button
                  disabled={saving}
                  onClick={() => handleSetBalance('cashfree')}
                  className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  Set
                </button>
                <button
                  onClick={() => setEditingWallet(null)}
                  className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => openEdit('cashfree', wallets.cashfree)}
                className="mt-1 self-start text-[10px] text-emerald-500 hover:text-emerald-400"
              >
                Update balance
              </button>
            )}
          </div>

          {/* Total */}
          <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-4 flex flex-col gap-1">
            <p className="text-xs text-blue-400">Total Liquid</p>
            <p className="text-2xl font-semibold tabular-nums text-slate-200">{fmtINR(total_liquid)}</p>
            <p className="text-[10px] text-slate-600">bank + vFulfill + Cashfree</p>
          </div>

        </div>
      </div>

      {/* ── COD Float ── */}
      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">COD Float</p>
          <p className="text-2xl font-semibold tabular-nums text-slate-100 mt-1">{fmtINR(cod_float)}</p>
          <p className="text-sm text-slate-500 mt-0.5">
            {cod_active_count} active COD {cod_active_count === 1 ? 'order' : 'orders'} in transit
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-slate-600">Cash held by courier</p>
          <p className="text-xs text-slate-600">arrives in vFulfill wallet</p>
          <p className="text-xs text-slate-600">after delivery + remittance</p>
        </div>
      </div>

      {/* ── Partner Capital ── */}
      {partners.length > 0 && (
        <div>
          <SectionHeading>Partner Capital</SectionHeading>
          <div className="rounded-2xl border border-slate-700 bg-slate-900 overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Partner</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Repaid</th>
                  <th className="px-4 py-3 text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {partners.map(p => (
                  <tr key={p.id} className="hover:bg-slate-800/60">
                    <td className="px-4 py-3">
                      <p className="text-slate-100 font-medium">{p.name}</p>
                      {p.note && <p className="text-xs text-slate-500 mt-0.5">{p.note}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{p.date}</td>
                    <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{fmtINR(p.principal)}</td>
                    <td className="px-4 py-3 text-right text-green-400 tabular-nums">{fmtINR(p.repaid)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-100 tabular-nums">{fmtINR(p.outstanding)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-800/40">
                  <td colSpan={4} className="px-4 py-2 text-xs text-slate-500 text-right font-semibold">
                    Total outstanding
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-slate-100 tabular-nums">
                    {fmtINR(partnerTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Loans Outstanding ── */}
      {loans.length > 0 && (
        <div>
          <SectionHeading>Loans Outstanding</SectionHeading>
          <div className="rounded-2xl border border-slate-700 bg-slate-900 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Lender</th>
                    <th className="px-4 py-3 text-right">Principal</th>
                    <th className="px-4 py-3 text-right">Repaid</th>
                    <th className="px-4 py-3 text-right">Rate</th>
                    <th className="px-4 py-3 text-right">Days</th>
                    <th className="px-4 py-3 text-right">Interest</th>
                    <th className="px-4 py-3 text-right">Total Due</th>
                    <th className="px-4 py-3 text-left">Due Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {loans.map(l => {
                    const overdue = l.repayment_due && l.repayment_due < data.today
                    return (
                      <tr key={l.id} className="hover:bg-slate-800/60">
                        <td className="px-4 py-3">
                          <p className="text-slate-100 font-medium">{l.name}</p>
                          {l.note && <p className="text-xs text-slate-500 mt-0.5">{l.note}</p>}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{fmtINR(l.principal)}</td>
                        <td className="px-4 py-3 text-right text-green-400 tabular-nums">{fmtINR(l.repaid)}</td>
                        <td className="px-4 py-3 text-right text-slate-400">{l.interest_rate_pct}%</td>
                        <td className="px-4 py-3 text-right text-slate-400 tabular-nums">{l.days_elapsed}</td>
                        <td className="px-4 py-3 text-right text-orange-400 tabular-nums">{fmtINR(l.interest_accrued)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-100 tabular-nums">{fmtINR(l.total_due)}</td>
                        <td className="px-4 py-3 text-xs">
                          {l.repayment_due ? (
                            <span className={overdue ? 'text-red-400 font-medium' : 'text-slate-400'}>
                              {l.repayment_due}{overdue ? ' — overdue' : ''}
                            </span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  <tr className="bg-slate-800/40">
                    <td colSpan={6} className="px-4 py-2 text-xs text-slate-500 text-right font-semibold">
                      Total due
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-slate-100 tabular-nums">
                      {fmtINR(loanTotalDue)}
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {partners.length === 0 && loans.length === 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center">
          <p className="text-sm text-slate-500">No capital or loan entries yet.</p>
          <p className="text-xs text-slate-600 mt-1">Add them in Data → Capital &amp; Loans.</p>
        </div>
      )}

    </div>
  )
}
