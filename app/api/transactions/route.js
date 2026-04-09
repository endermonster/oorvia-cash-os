import { supabase } from '@/lib/supabase'

export async function DELETE(request) {
  const { id } = await request.json()

  const { error } = await supabase.from('transactions').delete().eq('id', id)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ success: true })
}

export async function GET() {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .order('date', { ascending: false })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data)
}

export async function PATCH(request) {
  const body = await request.json()
  const { id, date, amount, type, source, category, notes } = body

  const { data, error } = await supabase
    .from('transactions')
    .update({ date, amount, type, source, category, notes })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data)
}

export async function POST(request) {
  const body = await request.json()
  const { date, amount, type, source, category, notes } = body

  const { data, error } = await supabase
    .from('transactions')
    .insert([{ date, amount, type, source, category, notes }])
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data, { status: 201 })
}
