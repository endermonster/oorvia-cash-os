import { supabase } from '@/lib/supabase'
import { selectAll } from '@/lib/paged'
import { monthRange } from '@/lib/dates'
import { COST_SOURCE } from '@/lib/constants'

function r2(n) { return Math.round(n * 100) / 100 }

// Map wallet_transactions.type → cod_wallet entry_type
function walletTxnType(type) {
  if (type === 'recharge')    return 'add_funds'
  if (type === 'withdrawal')  return 'withdrawal'
  return 'debit' // service_fee, sourcing
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month')

  const range = month ? monthRange(month) : null
  const start = range?.from ?? null
  const end   = range?.to   ?? null

  // The caller derives a running wallet balance from this list, so every read
  // below must be complete — a truncated page silently shifts the balance.
  let manualEntries, orderCosts, walletTxns
  try {
    // 1. Manual entries from cod_wallet_entries
    manualEntries = await selectAll(() => {
      let q = supabase.from('cod_wallet_entries').select('*')
      if (start) q = q.gte('entry_date', start).lte('entry_date', end)
      return q
    })

    // 2. Per-order vFulfill credits (COD remittances) and debits (fees) from order_costs
    orderCosts = await selectAll(() => {
      let q = supabase
        .from('order_costs')
        .select('id, shopify_order_name, transaction_head, total_amt, transaction_date, nature')
        .eq('source', COST_SOURCE.VFULFILL)
      if (start) q = q.gte('transaction_date', start).lte('transaction_date', end)
      return q
    })

    // 3. Wallet-level vFulfill transactions (recharges, withdrawals, service fees)
    walletTxns = await selectAll(() => {
      let q = supabase
        .from('wallet_transactions')
        .select('id, type, amount, date, note')
        .eq('wallet', 'vfulfill')
      if (start) q = q.gte('date', start).lte('date', end)
      return q
    })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }

  // Build unified entry list
  const entries = []

  for (const e of (manualEntries || [])) {
    entries.push({ ...e, _source: 'manual' })
  }

  for (const c of (orderCosts || [])) {
    entries.push({
      id:                 `oc_${c.id}`,
      entry_date:         c.transaction_date,
      entry_type:         c.nature === 'credit' ? 'credit' : 'debit',
      amount:             r2(Number(c.total_amt)),
      reference:          c.shopify_order_name,
      notes:              c.transaction_head,
      transaction_status: 'completed',
      _source:            'order_costs',
    })
  }

  for (const t of (walletTxns || [])) {
    entries.push({
      id:                 `wt_${t.id}`,
      entry_date:         t.date,
      entry_type:         walletTxnType(t.type),
      amount:             r2(Number(t.amount)),
      reference:          null,
      notes:              t.note,
      transaction_status: 'completed',
      _source:            'wallet_transactions',
    })
  }

  // Sort ascending by date for running balance calculation
  entries.sort((a, b) => (a.entry_date ?? '').localeCompare(b.entry_date ?? ''))

  return Response.json(entries)
}

export async function POST(request) {
  const body = await request.json()
  const { entry_date, entry_type, amount, order_id, reference, notes } = body

  const { data, error } = await supabase
    .from('cod_wallet_entries')
    .insert([{
      entry_date,
      entry_type,
      amount: parseFloat(amount),
      order_id: order_id || null,
      reference: reference || null,
      notes: notes || null,
    }])
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}
