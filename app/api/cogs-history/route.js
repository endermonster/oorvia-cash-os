import { supabase } from '@/lib/supabase'
import { selectAll } from '@/lib/paged'

// cogs_history is a chain of half-open intervals per SKU:
//   entry.effective_to === next entry's effective_from, and exactly one entry
//   (the latest) has effective_to = null. products.current_cogs must mirror
//   that open entry — never an older, back-dated correction.

function readHistory(sku) {
  return selectAll(() =>
    supabase
      .from('cogs_history')
      .select('*')
      .eq('sku', sku)
      .order('effective_from', { ascending: false })
  )
}

// products.current_cogs follows the entry with the greatest effective_from.
async function syncCurrentCogs(sku, entries) {
  if (entries.length === 0) return null
  const latest = entries.reduce((a, b) => (a.effective_from >= b.effective_from ? a : b))
  await supabase.from('products').update({ current_cogs: latest.cogs }).eq('sku', sku)
  return latest.cogs
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const sku = searchParams.get('sku')
  if (!sku) return Response.json({ error: 'sku is required' }, { status: 400 })

  try {
    return Response.json(await readHistory(sku))
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request) {
  const { sku, cogs, effective_from, note } = await request.json()
  if (!sku || cogs === undefined || !effective_from) {
    return Response.json({ error: 'sku, cogs, and effective_from are required' }, { status: 400 })
  }

  const newCogs = parseFloat(cogs)
  if (!Number.isFinite(newCogs)) {
    return Response.json({ error: 'cogs must be a number' }, { status: 400 })
  }

  const fromDate = String(effective_from).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    return Response.json({ error: 'effective_from must be YYYY-MM-DD' }, { status: 400 })
  }

  let existing
  try {
    existing = await readHistory(sku)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }

  // The open entry is the one this insert would close. Starting the new interval
  // on or before that date produces a zero-width or negative-width interval, and
  // every COGS lookup between those dates then picks an arbitrary row.
  const openEntries = existing.filter((e) => e.effective_to === null)
  const openEntry = openEntries.length > 0
    ? openEntries.reduce((a, b) => (a.effective_from >= b.effective_from ? a : b))
    : null

  if (openEntry && fromDate <= openEntry.effective_from) {
    return Response.json({
      error: `effective_from must be after ${openEntry.effective_from}, the start of the current COGS entry for ${sku}. Correct the existing entry instead of back-dating a new one.`,
    }, { status: 400 })
  }

  // Close the current open entry (or entries, if the chain had drifted)
  await supabase
    .from('cogs_history')
    .update({ effective_to: fromDate })
    .eq('sku', sku)
    .is('effective_to', null)

  const { data, error } = await supabase
    .from('cogs_history')
    .insert([{ sku, cogs: newCogs, effective_from: fromDate, effective_to: null, note: note || null }])
    .select()
    .single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Only mirror into products.current_cogs when this really is the newest entry.
  // A correction filed against a closed historical interval must not change
  // today's cost — that silently re-prices every open order.
  const isLatest = existing.every((e) => fromDate >= e.effective_from)
  if (isLatest) {
    await supabase.from('products').update({ current_cogs: newCogs }).eq('sku', sku)
  }

  return Response.json({ ...data, current_cogs_synced: isLatest }, { status: 201 })
}

// DELETE /api/cogs-history  body: { id }
// Removes one entry and repairs the interval chain around it, then re-syncs
// products.current_cogs from whichever entry is latest afterwards.
export async function DELETE(request) {
  const { id } = await request.json()
  if (id === undefined || id === null || id === '') {
    return Response.json({ error: 'id is required' }, { status: 400 })
  }

  const { data: target, error: findErr } = await supabase
    .from('cogs_history')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (findErr) return Response.json({ error: findErr.message }, { status: 500 })
  if (!target)  return Response.json({ error: 'Entry not found' }, { status: 404 })

  const sku = target.sku

  let siblings
  try {
    siblings = (await readHistory(sku)).filter((e) => String(e.id) !== String(id))
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }

  // Neighbours of the entry being removed, by effective_from.
  const before = siblings.filter((e) => e.effective_from < target.effective_from)
  const after  = siblings.filter((e) => e.effective_from > target.effective_from)
  const prev = before.length > 0 ? before.reduce((a, b) => (a.effective_from >= b.effective_from ? a : b)) : null
  const next = after.length  > 0 ? after.reduce((a, b) => (a.effective_from <= b.effective_from ? a : b))  : null

  const { error: delErr } = await supabase.from('cogs_history').delete().eq('id', id)
  if (delErr) return Response.json({ error: delErr.message }, { status: 500 })

  // Close the gap: the previous entry now runs until the next one starts, or is
  // re-opened (effective_to = null) if the deleted entry was the last in the chain.
  let reopened = false
  if (prev) {
    const newTo = next ? next.effective_from : null
    if (prev.effective_to !== newTo) {
      const { error: fixErr } = await supabase
        .from('cogs_history')
        .update({ effective_to: newTo })
        .eq('id', prev.id)
      if (fixErr) return Response.json({ error: fixErr.message }, { status: 500 })
      siblings = siblings.map((e) => (e.id === prev.id ? { ...e, effective_to: newTo } : e))
      reopened = newTo === null
    }
  }

  // With no history left there is no derivable current cost — keep the last
  // known products.current_cogs rather than silently zeroing it.
  const current_cogs = await syncCurrentCogs(sku, siblings)

  return Response.json({
    success: true,
    sku,
    deleted_id: id,
    reopened_id: reopened ? prev.id : null,
    current_cogs,
    current_cogs_synced: current_cogs !== null,
  })
}
