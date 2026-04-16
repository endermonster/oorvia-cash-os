import { supabase } from '@/lib/supabase'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month')

  let query = supabase
    .from('cod_wallet_entries')
    .select('*')
    .order('entry_date', { ascending: true })

  if (month) {
    const [y, m] = month.split('-').map(Number)
    const start = `${y}-${String(m).padStart(2, '0')}-01`
    const end = new Date(y, m, 0).toISOString().slice(0, 10)
    query = query.gte('entry_date', start).lte('entry_date', end)
  }

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
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
