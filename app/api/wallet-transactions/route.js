import { supabase } from '@/lib/supabase'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const wallet = searchParams.get('wallet') // optional filter
  const month  = searchParams.get('month')  // YYYY-MM, optional

  let query = supabase.from('wallet_transactions').select('*').order('date', { ascending: false })
  if (wallet) query = query.eq('wallet', wallet)
  if (month) {
    const [y, m] = month.split('-').map(Number)
    const start = `${y}-${String(m).padStart(2, '0')}-01`
    const end   = new Date(y, m, 0).toISOString().slice(0, 10)
    query = query.gte('date', start).lte('date', end)
  }

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
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
