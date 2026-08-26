import { supabase } from '@/lib/supabase'
import { selectAll } from '@/lib/paged'
import { monthRange } from '@/lib/dates'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month') // YYYY-MM

  // The caller totals these rows for spend and ITC, so the read must be complete.
  try {
    const rows = await selectAll(() => {
      let q = supabase.from('marketing_spend').select('*').order('date', { ascending: false })
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
