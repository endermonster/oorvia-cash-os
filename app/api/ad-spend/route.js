import { supabase } from '@/lib/supabase'
import { selectAll } from '@/lib/paged'
import { monthRange } from '@/lib/dates'

// ad_spend holds one row per campaign per day, so a year of Meta syncing runs
// well past the PostgREST row cap — read it paged or the month totals understate.
function readRows(month) {
  return selectAll(() => {
    let q = supabase.from('ad_spend').select('*').order('spend_date', { ascending: false })
    if (month) {
      const { from, to } = monthRange(month)
      q = q.gte('spend_date', from).lte('spend_date', to)
    }
    return q
  })
}

// Meta-synced rows carry a campaign_id and upsert on (spend_date, campaign_id).
// Manual rows leave campaign_id NULL, so they never conflict with a later sync —
// a date holding both kinds counts its spend twice in P&L, ITC and ROAS.
function duplicateDates(rows) {
  const byDate = new Map()
  for (const r of rows) {
    const d = r.spend_date
    if (!d) continue
    if (!byDate.has(d)) byDate.set(d, { meta: 0, manual: 0 })
    const b = byDate.get(d)
    if (r.campaign_id) b.meta += 1
    else b.manual += 1
  }
  return [...byDate.entries()]
    .filter(([, b]) => b.meta > 0 && b.manual > 0)
    .map(([date, b]) => ({ date, meta_rows: b.meta, manual_rows: b.manual }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// GET /api/ad-spend?month=YYYY-MM            → rows, each tagged source: meta|manual
// GET /api/ad-spend?month=&check=duplicates  → { duplicate_dates, duplicate_warning }
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month')
  const check = searchParams.get('check')

  try {
    const rows = await readRows(month)

    if (check === 'duplicates') {
      const dupes = duplicateDates(rows)
      return Response.json({
        month:           month || null,
        duplicate_dates: dupes,
        duplicate_warning: dupes.length > 0
          ? `${dupes.length} date(s) have both a manually-entered and a Meta-synced ad spend row. Spend on those dates is counted twice.`
          : null,
      })
    }

    // Collection response stays an array — `source` lets the UI flag manual rows
    // that a Meta sync would duplicate rather than overwrite.
    return Response.json(rows.map((r) => ({ ...r, source: r.campaign_id ? 'meta' : 'manual' })))
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
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

  // No campaign_id, so /api/sync/meta cannot conflict-resolve against this row.
  // Warn the caller instead of silently setting up a double count.
  let duplicate_warning = null
  if (spend_date) {
    const { data: synced } = await supabase
      .from('ad_spend')
      .select('id')
      .eq('spend_date', spend_date)
      .not('campaign_id', 'is', null)
      .limit(1)
    if (synced && synced.length > 0) {
      duplicate_warning = `${spend_date} already has Meta-synced ad spend. This manual row is counted on top of it, not instead of it.`
    }
  }

  return Response.json({ ...data, source: 'manual', duplicate_warning }, { status: 201 })
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
