import { supabase } from '@/lib/supabase'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const sku = searchParams.get('sku')
  if (!sku) return Response.json({ error: 'sku is required' }, { status: 400 })

  const { data, error } = await supabase
    .from('cogs_history')
    .select('*')
    .eq('sku', sku)
    .order('effective_from', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(request) {
  const { sku, cogs, effective_from, note } = await request.json()
  if (!sku || cogs === undefined || !effective_from) {
    return Response.json({ error: 'sku, cogs, and effective_from are required' }, { status: 400 })
  }

  const newCogs = parseFloat(cogs)
  const fromDate = effective_from

  // Close the current open entry
  await supabase
    .from('cogs_history')
    .update({ effective_to: fromDate })
    .eq('sku', sku)
    .is('effective_to', null)

  // Insert the new entry
  const { data, error } = await supabase
    .from('cogs_history')
    .insert([{ sku, cogs: newCogs, effective_from: fromDate, effective_to: null, note: note || null }])
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Keep products.current_cogs in sync
  await supabase.from('products').update({ current_cogs: newCogs }).eq('sku', sku)

  return Response.json(data, { status: 201 })
}
