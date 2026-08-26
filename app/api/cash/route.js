import { supabase } from '@/lib/supabase'
import { selectAll } from '@/lib/paged'
import { today as todayYmd, parseYmd } from '@/lib/dates'
import { COD_FLOAT_STATUSES, COST_SOURCE, PAYMENT_TYPE } from '@/lib/constants'

function r2(n) { return Math.round(n * 100) / 100 }

function daysBetween(dateStr, today) {
  const d1 = parseYmd(String(dateStr).slice(0, 10))
  const d2 = parseYmd(today)
  return Math.max(0, Math.floor((d2 - d1) / 86400000))
}

export async function GET() {
  try {
    return await buildCashPosition()
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

async function buildCashPosition() {
  const today = todayYmd()

  // ── vFulfill wallet: sum across wallet_transactions + order_costs ──
  // wallet_transactions captures recharges / withdrawals / service fees
  // order_costs captures per-order fees (debit) and COD remittances (credit)
  // Both tables grow past the PostgREST row cap — read them fully or the
  // vFulfill balance silently drifts.
  const [walletTxns, vfCosts] = await Promise.all([
    selectAll(() => supabase.from('wallet_transactions').select('wallet, type, amount, date')),
    selectAll(() =>
      supabase
        .from('order_costs')
        .select('nature, taxable_amt, gst_amt')
        .eq('source', COST_SOURCE.VFULFILL)
    ),
  ])

  // Wallet transaction balances
  let vfulfillBalance  = 0
  let bankLatest       = null
  let cashfreeLatest   = null
  let bankAsOf         = null
  let cashfreeAsOf     = null

  // Sort ascending so the last snapshot processed is the most recent
  const wtSorted = walletTxns.slice().sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
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
  for (const c of vfCosts) {
    const amt = r2(Number(c.taxable_amt || 0) + Number(c.gst_amt || 0))
    vfulfillBalance = r2(vfulfillBalance + (c.nature === 'credit' ? amt : -amt))
  }

  // ── COD float: COD cash sitting with the courier ──
  // Only genuinely in-transit orders count. 'unfulfilled' has not shipped and
  // 'delivered' has already remitted, so neither is float.
  const codOrders = await selectAll(() =>
    supabase
      .from('orders')
      .select('order_value')
      .eq('payment_type', PAYMENT_TYPE.COD)
      .in('status', COD_FLOAT_STATUSES)
  )

  const cod_float       = r2(codOrders.reduce((s, o) => s + Number(o.order_value || 0), 0))
  const cod_active_count = codOrders.length

  // ── Capital infusions ──
  const infusions = await selectAll(() =>
    supabase.from('capital_infusions').select('*').order('date', { ascending: true })
  )

  const partners = []
  const loans    = []

  for (const inf of infusions) {
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
