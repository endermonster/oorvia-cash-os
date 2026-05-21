import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('pre_gst_baseline')
    .select('*')
    .eq('id', 1)
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'No baseline found. Run the SQL setup in Supabase.' }, { status: 404 })
  return Response.json(data)
}

export async function PUT(request) {
  const body = await request.json()
  const { revenue, cogs, ad_spend, fulfillment_fees, payment_fees, fixed_costs, net_pnl, notes, period_end } = body

  if (net_pnl === undefined) return Response.json({ error: 'net_pnl required' }, { status: 400 })

  const { data, error } = await supabase
    .from('pre_gst_baseline')
    .upsert({ id: 1, revenue, cogs, ad_spend, fulfillment_fees, payment_fees, fixed_costs, net_pnl, notes, period_end })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
