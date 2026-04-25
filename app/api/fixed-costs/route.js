import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('fixed_costs')
    .select('*')
    .order('name')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(request) {
  const { name, amount, frequency, start_date, end_date, category, gst_inclusive } = await request.json()
  if (!name || !amount || !frequency || !start_date) {
    return Response.json({ error: 'name, amount, frequency, start_date are required' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('fixed_costs')
    .insert([{
      name,
      amount: parseFloat(amount),
      frequency,
      start_date,
      end_date: end_date || null,
      category: category || null,
      gst_inclusive: gst_inclusive === true,
    }])
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}

export async function PATCH(request) {
  const { id, ...body } = await request.json()
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 })
  const fields = {}
  if (body.name          !== undefined) fields.name          = body.name
  if (body.amount        !== undefined) fields.amount        = parseFloat(body.amount)
  if (body.frequency     !== undefined) fields.frequency     = body.frequency
  if (body.start_date    !== undefined) fields.start_date    = body.start_date
  if (body.end_date      !== undefined) fields.end_date      = body.end_date || null
  if (body.category      !== undefined) fields.category      = body.category || null
  if (body.gst_inclusive !== undefined) fields.gst_inclusive = body.gst_inclusive === true
  const { data, error } = await supabase.from('fixed_costs').update(fields).eq('id', id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function DELETE(request) {
  const { id } = await request.json()
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 })
  const { error } = await supabase.from('fixed_costs').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
