import { supabase } from '@/lib/supabase'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month') // YYYY-MM

  if (!month) return Response.json({ error: 'month param required' }, { status: 400 })

  const monthDate = month + '-01' // first day of month for the unique key

  const { data, error } = await supabase
    .from('monthly_pnl')
    .select('*')
    .eq('month', monthDate)
    .single()

  if (error && error.code !== 'PGRST116') { // PGRST116 = not found
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data || null)
}
