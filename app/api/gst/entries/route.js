import { supabase } from '@/lib/supabase'
import { selectAll } from '@/lib/paged'
import { monthStart } from '@/lib/dates'

// Manual entries exist for ONE purpose: external purchases where GST was claimed
// outside the normal scope of the business. Auto-derived ITC (3PL, checkout,
// payment gateway, Meta ads) is already computed in /api/gst — entering it here
// double-counts it.
const ENTRY_TYPES = ['itc', 'otc']

// entry_month is a date column pinned to the first of the month. Accepts
// 'YYYY-MM' or any 'YYYY-MM-DD' inside the month and normalises both.
function normaliseEntryMonth(value) {
  const m = String(value ?? '').trim().match(/^(\d{4})-(\d{2})/)
  if (!m) return null
  const mm = Number(m[2])
  if (mm < 1 || mm > 12) return null
  return monthStart(`${m[1]}-${m[2]}`)
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const month = normaliseEntryMonth(searchParams.get('month'))
  if (!month) return Response.json({ error: 'month param required (YYYY-MM)' }, { status: 400 })

  try {
    const rows = await selectAll(() =>
      supabase.from('gst_entries').select('*')
        .eq('entry_month', month)
        .order('created_at', { ascending: false })
    )
    return Response.json(rows)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request) {
  const body = await request.json()
  const { entry_month, type, source, description, taxable_amount, gst_rate, notes } = body

  const month = normaliseEntryMonth(entry_month)
  if (!month) return Response.json({ error: 'entry_month is required (YYYY-MM or YYYY-MM-DD)' }, { status: 400 })

  if (!ENTRY_TYPES.includes(type)) {
    return Response.json({ error: `type must be one of ${ENTRY_TYPES.join(', ')}` }, { status: 400 })
  }

  const src = String(source ?? '').trim()
  if (!src) return Response.json({ error: 'source is required' }, { status: 400 })

  const taxable = String(taxable_amount ?? '').trim() === '' ? NaN : Number(taxable_amount)
  if (!Number.isFinite(taxable) || taxable < 0) {
    return Response.json({ error: 'taxable_amount must be a number >= 0' }, { status: 400 })
  }

  const rate = String(gst_rate ?? '').trim() === '' ? NaN : Number(gst_rate)
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return Response.json({ error: 'gst_rate must be a number between 0 and 100' }, { status: 400 })
  }

  // Always recomputed server-side — a client-sent gst_amount is never trusted.
  const gst_amount = Math.round(taxable * rate / 100 * 100) / 100

  const { data, error } = await supabase
    .from('gst_entries')
    .insert([{
      entry_month:    month,
      type,
      source:         src,
      description:    description || null,
      taxable_amount: Math.round(taxable * 100) / 100,
      gst_rate:       rate,
      gst_amount,
      notes:          notes || null,
    }])
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}

export async function DELETE(request) {
  const { id } = await request.json()
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 })
  const { error } = await supabase.from('gst_entries').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
