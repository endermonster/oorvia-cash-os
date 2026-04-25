import { supabase } from '@/lib/supabase'

function r2(n) { return Math.round(n * 100) / 100 }

function daysBetween(dateStr, today) {
  const d1 = new Date(dateStr)
  const d2 = new Date(today)
  return Math.max(0, Math.floor((d2 - d1) / 86400000))
}

export async function GET() {
  const today = new Date().toISOString().slice(0, 10)

  // ── vFulfill wallet: sum across wallet_transactions + order_costs ──
  // wallet_transactions captures recharges / withdrawals / service fees
  // order_costs captures per-order fees (debit) and COD remittances (credit)
  const [wtRes, ocRes] = await Promise.all([
    supabase.from('wallet_transactions').select('wallet, type, amount, date'),
    supabase
      .from('order_costs')
      .select('nature, taxable_amt, gst_amt')
      .eq('source', 'vfulfill'),
  ])
  if (wtRes.error) return Response.json({ error: wtRes.error.message }, { status: 500 })
  if (ocRes.error) return Response.json({ error: ocRes.error.message }, { status: 500 })

  // Wallet transaction balances
  let vfulfillBalance  = 0
  let bankLatest       = null
  let cashfreeLatest   = null
  let bankAsOf         = null
  let cashfreeAsOf     = null

  // Sort ascending so the last snapshot processed is the most recent
  const wtSorted = (wtRes.data || []).slice().sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  for (const t of wtSorted) {
    const amt = Number(t.amount || 0)
    if (t.wallet === 'vfulfill') {
      const isCredit = t.type === 'recharge'
      vfulfillBalance = r2(vfulfillBalance + (isCredit ? amt : -amt))
    } else if (t.wallet === 'bank') {
      if (t.type === 'snapshot') { bankLatest = amt; bankAsOf = t.date }
    } else if (t.wallet === 'cashfree') {
      if (t.type === 'snapshot') { cashfreeLatest = amt; cashfreeAsOf = t.date }
    }
  }

  // Add vFulfill order-level credits/debits (COD remittances and fulfillment fees)
  for (const c of (ocRes.data || [])) {
    const amt = r2(Number(c.taxable_amt || 0) + Number(c.gst_amt || 0))
    vfulfillBalance = r2(vfulfillBalance + (c.nature === 'credit' ? amt : -amt))
  }

  // ── COD float: active COD orders in transit ──
  const { data: codOrders, error: codErr } = await supabase
    .from('orders')
    .select('order_value')
    .eq('payment_type', 'cash_on_delivery')
    .eq('status', 'active')
  if (codErr) return Response.json({ error: codErr.message }, { status: 500 })

  const cod_float       = r2((codOrders || []).reduce((s, o) => s + Number(o.order_value || 0), 0))
  const cod_active_count = (codOrders || []).length

  // ── Capital infusions ──
  const { data: infusions, error: capErr } = await supabase
    .from('capital_infusions')
    .select('*')
    .order('date', { ascending: true })
  if (capErr) return Response.json({ error: capErr.message }, { status: 500 })

  const partners = []
  const loans    = []

  for (const inf of (infusions || [])) {
    const principal  = Number(inf.amount || 0)
    const repaid     = Number(inf.repaid_amount || 0)
    const outstanding = r2(principal - repaid)

    if (inf.contributor_type === 'partner') {
      partners.push({
        id: inf.id,
        name: inf.contributor_name,
        principal,
        repaid,
        outstanding,
        date: inf.date,
        note: inf.note,
      })
    } else if (inf.contributor_type === 'loan') {
      const rate             = Number(inf.interest_rate || 0) // stored as decimal
      const days             = daysBetween(inf.date, today)
      const interest_accrued = r2(principal * rate * days / 365)
      const total_due        = r2(outstanding + interest_accrued)
      loans.push({
        id: inf.id,
        name: inf.contributor_name,
        principal,
        repaid,
        outstanding,
        interest_rate_pct: r2(rate * 100),
        days_elapsed: days,
        interest_accrued,
        total_due,
        date: inf.date,
        repayment_due: inf.repayment_due,
        note: inf.note,
      })
    }
  }

  const bank_balance     = bankLatest ?? 0
  const cashfree_balance = cashfreeLatest ?? 0
  const total_liquid     = r2(r2(vfulfillBalance) + bank_balance + cashfree_balance)

  return Response.json({
    today,
    wallets: {
      vfulfill:       r2(vfulfillBalance),
      bank:           bank_balance,
      bank_as_of:     bankAsOf,
      cashfree:       cashfree_balance,
      cashfree_as_of: cashfreeAsOf,
    },
    total_liquid,
    cod_float,
    cod_active_count,
    partners,
    loans,
  })
}
