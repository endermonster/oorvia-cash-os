import { supabase } from '@/lib/supabase'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month') // YYYY-MM

  let query = supabase.from('marketing_spend').select('*').order('date', { ascending: false })

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
  const { platform, amount, date, campaign, gst_amt } = await request.json()
  if (!platform || !amount || !date) {
    return Response.json({ error: 'platform, amount, date are required' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('marketing_spend')
    .insert([{
      platform,
      amount:   parseFloat(amount),
      date,
      campaign: campaign || null,
      gst_amt:  parseFloat(gst_amt) || 0,
    }])
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}

export async function DELETE(request) {
  const { id } = await request.json()
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 })
  const { error } = await supabase.from('marketing_spend').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
