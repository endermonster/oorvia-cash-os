import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('name')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(request) {
  const { sku, name, current_cogs, default_selling_price, hsn_code, gst_percentage } = await request.json()
  if (!sku || !name) return Response.json({ error: 'sku and name are required' }, { status: 400 })

  const cogs = parseFloat(current_cogs) || 0

  const { data, error } = await supabase
    .from('products')
    .insert([{ sku, name, current_cogs: cogs, default_selling_price: parseFloat(default_selling_price) || null, hsn_code: hsn_code || null, gst_percentage: parseFloat(gst_percentage) || 18 }])
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Seed cogs_history with the opening entry
  if (cogs > 0) {
    await supabase.from('cogs_history').insert([{
      sku,
      cogs,
      effective_from: new Date().toISOString().slice(0, 10),
      note: 'Initial entry',
    }])
  }

  return Response.json(data, { status: 201 })
}

export async function PATCH(request) {
  const { sku, ...updates } = await request.json()
  if (!sku) return Response.json({ error: 'sku is required' }, { status: 400 })

  const fields = {}
  if (updates.name                !== undefined) fields.name                = updates.name
  if (updates.default_selling_price !== undefined) fields.default_selling_price = parseFloat(updates.default_selling_price) || null
  if (updates.hsn_code            !== undefined) fields.hsn_code            = updates.hsn_code || null
  if (updates.gst_percentage      !== undefined) fields.gst_percentage      = parseFloat(updates.gst_percentage) || 18

  const { data, error } = await supabase.from('products').update(fields).eq('sku', sku).select().single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function DELETE(request) {
  const { sku } = await request.json()
  if (!sku) return Response.json({ error: 'sku is required' }, { status: 400 })
  const { error } = await supabase.from('products').delete().eq('sku', sku)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
