import { supabase } from '@/lib/supabase'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month')
  if (!month) return Response.json({ error: 'month required' }, { status: 400 })
  const { data } = await supabase
    .from('gst_credit_ledger')
    .select('*')
    .eq('month', month)
    .maybeSingle()
  return Response.json({
    month,
    opening_balance: Number(data?.opening_balance || 0),
    is_manual: data?.is_manual || false,
  })
}

export async function POST(request) {
  const { month, opening_balance } = await request.json()
  if (!month || opening_balance === undefined)
    return Response.json({ error: 'month and opening_balance required' }, { status: 400 })
  const { error } = await supabase
    .from('gst_credit_ledger')
    .upsert({ month, opening_balance: Number(opening_balance), is_manual: true }, { onConflict: 'month' })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(request) {
  const { month } = await request.json()
  if (!month) return Response.json({ error: 'month required' }, { status: 400 })
  const { error } = await supabase
    .from('gst_credit_ledger')
    .delete()
    .eq('month', month)
    .eq('is_manual', true)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
