import { supabase } from '@/lib/supabase'
import { selectAll } from '@/lib/paged'
import { monthRange } from '@/lib/dates'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const wallet = searchParams.get('wallet') // optional filter
  const month  = searchParams.get('month')  // YYYY-MM, optional

  // vFulfill CSV re-imports push this table past the PostgREST row cap, and the
  // ledger is summed into a wallet balance — read it in full.
  try {
    const rows = await selectAll(() => {
      let q = supabase.from('wallet_transactions').select('*').order('date', { ascending: false })
      if (wallet) q = q.eq('wallet', wallet)
      if (month) {
        const { from, to } = monthRange(month)
        q = q.gte('date', from).lte('date', to)
      }
      return q
    })
    return Response.json(rows)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request) {
  const { wallet, type, amount, date, note } = await request.json()
  if (!wallet || !type || !amount || !date) {
    return Response.json({ error: 'wallet, type, amount, date are required' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('wallet_transactions')
    .insert([{ wallet, type, amount: parseFloat(amount), date, note: note || null }])
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}

export async function DELETE(request) {
  const { id } = await request.json()
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 })
  // Prevent deleting vFulfill-imported rows from the manual UI
  const { data: row } = await supabase.from('wallet_transactions').select('vf_transaction_id').eq('id', id).single()
  if (row?.vf_transaction_id) {
    return Response.json({ error: 'Cannot delete vFulfill-imported entries from here. Re-run the vFulfill import to update.' }, { status: 400 })
  }
  const { error } = await supabase.from('wallet_transactions').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
