import { supabase } from '@/lib/supabase'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month')

  let query = supabase.from('ad_spend').select('*').order('spend_date', { ascending: false })

  if (month) {
    const [y, m] = month.split('-').map(Number)
    const start = `${y}-${String(m).padStart(2, '0')}-01`
    const end = new Date(y, m, 0).toISOString().slice(0, 10)
    query = query.gte('spend_date', start).lte('spend_date', end)
  }

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(request) {
  const body = await request.json()
  const { spend_date, campaign, adset, spend, impressions, clicks, purchases, notes } = body

  const { data, error } = await supabase
    .from('ad_spend')
    .insert([{
      spend_date,
      campaign: campaign || null,
      adset: adset || null,
      spend: parseFloat(spend),
      impressions: impressions ? parseInt(impressions) : null,
      clicks: clicks ? parseInt(clicks) : null,
      purchases: purchases ? parseInt(purchases) : null,
      notes: notes || null,
    }])
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}

export async function PATCH(request) {
  const body = await request.json()
  const { id, spend_date, campaign, adset, spend, impressions, clicks, purchases, notes } = body

  const updates = {}
  if (spend_date !== undefined) updates.spend_date = spend_date
  if (campaign !== undefined) updates.campaign = campaign || null
  if (adset !== undefined) updates.adset = adset || null
  if (spend !== undefined) updates.spend = parseFloat(spend)
  if (impressions !== undefined) updates.impressions = impressions ? parseInt(impressions) : null
  if (clicks !== undefined) updates.clicks = clicks ? parseInt(clicks) : null
  if (purchases !== undefined) updates.purchases = purchases ? parseInt(purchases) : null
  if (notes !== undefined) updates.notes = notes || null

  const { data, error } = await supabase.from('ad_spend').update(updates).eq('id', id).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function DELETE(request) {
  const { id } = await request.json()
  const { error } = await supabase.from('ad_spend').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
