import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('capital_infusions')
    .select('*')
    .order('date', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(request) {
  const body = await request.json()
  const { contributor_name, contributor_type, amount, date, interest_rate, repayment_due, repaid_amount, note } = body
  if (!contributor_name || !contributor_type || !amount || !date) {
    return Response.json({ error: 'contributor_name, contributor_type, amount, date are required' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('capital_infusions')
    .insert([{
      contributor_name,
      contributor_type,
      amount: parseFloat(amount),
      date,
      interest_rate: interest_rate ? parseFloat(interest_rate) / 100 : null,
      repayment_due: repayment_due || null,
      repaid_amount: parseFloat(repaid_amount) || 0,
      note: note || null,
    }])
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}

export async function PATCH(request) {
  const { id, repaid_amount, note, repayment_due } = await request.json()
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 })
  const fields = {}
  if (repaid_amount !== undefined) fields.repaid_amount = parseFloat(repaid_amount) || 0
  if (note          !== undefined) fields.note = note || null
  if (repayment_due !== undefined) fields.repayment_due = repayment_due || null
  const { data, error } = await supabase.from('capital_infusions').update(fields).eq('id', id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function DELETE(request) {
  const { id } = await request.json()
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 })
  const { error } = await supabase.from('capital_infusions').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
