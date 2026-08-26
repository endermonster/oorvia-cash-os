import { supabase } from '@/lib/supabase'
import { selectAll } from '@/lib/paged'

async function fetchUsdInrRate() {
  try {
    const res  = await fetch('https://api.frankfurter.app/latest?from=USD&to=INR')
    const data = await res.json()
    return data.rates?.INR || 84
  } catch {
    return 84
  }
}

export async function GET() {
  // Fixed costs are summed into the monthly P&L — the set must be complete.
  try {
    const rows = await selectAll(() => supabase.from('fixed_costs').select('*').order('name'))
    return Response.json(rows)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request) {
  const { name, frequency, start_date, end_date, category, gst_inclusive, usd_amount, amount } = await request.json()
  if (!name || !frequency || !start_date) {
    return Response.json({ error: 'name, frequency, start_date are required' }, { status: 400 })
  }

  let finalAmount
  if (usd_amount) {
    const rate  = await fetchUsdInrRate()
    finalAmount = parseFloat((parseFloat(usd_amount) * rate).toFixed(2))
  } else {
    if (!amount) return Response.json({ error: 'amount is required' }, { status: 400 })
    finalAmount = parseFloat(amount)
  }

  const { data, error } = await supabase
    .from('fixed_costs')
    .insert([{
      name,
      amount:        finalAmount,
      frequency,
      start_date,
      end_date:      end_date || null,
      category:      category || null,
      gst_inclusive: gst_inclusive === true,
      usd_amount:    usd_amount ? parseFloat(usd_amount) : null,
      fx_rate:       null,
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
  if (body.frequency     !== undefined) fields.frequency     = body.frequency
  if (body.start_date    !== undefined) fields.start_date    = body.start_date
  if (body.end_date      !== undefined) fields.end_date      = body.end_date || null
  if (body.category      !== undefined) fields.category      = body.category || null
  if (body.gst_inclusive !== undefined) fields.gst_inclusive = body.gst_inclusive === true
  if (body.usd_amount    !== undefined) fields.usd_amount    = body.usd_amount ? parseFloat(body.usd_amount) : null
  if (body.amount        !== undefined && !body.usd_amount) fields.amount = parseFloat(body.amount)
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
