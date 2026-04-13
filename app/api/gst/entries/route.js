import { supabase } from '@/lib/supabase'

export async function POST(request) {
  const body = await request.json()
  const { entry_month, type, source, description, taxable_amount, gst_rate, notes } = body

  if (!entry_month || !type || !source || taxable_amount === undefined || !gst_rate) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const taxable = parseFloat(taxable_amount)
  const rate = parseFloat(gst_rate)
  const gst_amount = Math.round(taxable * rate / 100 * 100) / 100

  const { data, error } = await supabase
    .from('gst_entries')
    .insert([{
      entry_month,
      type,
      source,
      description: description || null,
      taxable_amount: taxable,
      gst_rate: rate,
      gst_amount,
      notes: notes || null,
    }])
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}

export async function DELETE(request) {
  const { id } = await request.json()
  const { error } = await supabase.from('gst_entries').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
