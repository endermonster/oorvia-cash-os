'use client'

import { useEffect, useState } from 'react'
import SummaryCards from '@/components/SummaryCards'
import TransactionForm from '@/components/TransactionForm'
import TransactionTable from '@/components/TransactionTable'

export default function Home() {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/transactions')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setTransactions(data)
        else setError(data.error || 'Failed to load')
      })
      .catch(() => setError('Failed to load transactions'))
      .finally(() => setLoading(false))
  }, [])

  const handleAdded = (newTx) => {
    setTransactions((prev) => [newTx, ...prev])
  }

  const handleDeleted = (id) => {
    setTransactions((prev) => prev.filter((t) => t.id !== id))
  }

  const handleEdited = (updated) => {
    setTransactions((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Oorvia Cash OS</h1>
          <p className="text-sm text-zinc-400">Cash flow dashboard</p>
        </div>

        {loading ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : (
          <SummaryCards transactions={transactions} />
        )}

        <TransactionForm onAdded={handleAdded} />

        {!loading && !error && (
          <TransactionTable transactions={transactions} onDelete={handleDeleted} onEdit={handleEdited} />
        )}
      </div>
    </div>
  )
}
