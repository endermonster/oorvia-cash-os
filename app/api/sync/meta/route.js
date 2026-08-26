import { supabase } from '@/lib/supabase'

export async function POST(request) {
  const { from, to } = await request.json()
  if (!from || !to) return Response.json({ error: 'from and to required (YYYY-MM-DD)' }, { status: 400 })

  const accountId = process.env.META_AD_ACCOUNT_ID
  const token     = process.env.META_ACCESS_TOKEN
  if (!accountId || !token) {
    return Response.json({ error: 'META_AD_ACCOUNT_ID and META_ACCESS_TOKEN not set in .env.local' }, { status: 500 })
  }

  // Fetch all pages from Meta Insights API
  const rows = []
  let nextUrl = 'https://graph.facebook.com/v21.0/act_' + accountId + '/insights?' + new URLSearchParams({
    fields:         'campaign_id,campaign_name,spend,impressions,clicks,actions',
    level:          'campaign',
    time_increment: '1',
    time_range:     JSON.stringify({ since: from, until: to }),
    limit:          '500',
    access_token:   token,
  })

  while (nextUrl) {
    const res  = await fetch(nextUrl)
    const body = await res.json()
    if (body.error) return Response.json({ error: body.error.message }, { status: 400 })
    rows.push(...(body.data || []))
    nextUrl = body.paging?.next || null
  }

  if (rows.length === 0) {
    return Response.json({ synced: 0, message: 'No spend data in this date range' })
  }

  const adSpendRows = rows
    .map((r) => {
      const purchases = Number(
        (r.actions || []).find((a) => a.action_type === 'purchase' || a.action_type === 'omni_purchase')?.value ?? 0
      )
      return {
        spend_date:  r.date_start,
        campaign_id: r.campaign_id,
        campaign:    r.campaign_name,
        spend:       parseFloat(r.spend  || 0),
        impressions: parseInt(r.impressions || 0, 10),
        clicks:      parseInt(r.clicks   || 0, 10),
        purchases,
      }
    })
    .filter((r) => r.spend > 0)

  if (adSpendRows.length === 0) {
    return Response.json({ synced: 0, message: 'All rows had zero spend — nothing written' })
  }

  const { error } = await supabase
    .from('ad_spend')
    .upsert(adSpendRows, { onConflict: 'spend_date,campaign_id' })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // The upsert key is (spend_date, campaign_id). Manually-entered rows have a
  // NULL campaign_id, so they never conflict and this sync lands on top of them
  // rather than replacing them — the same spend then counts twice in P&L, ITC
  // and ROAS. Surface it; only a human can decide which row is the real one.
  const { data: manualRows } = await supabase
    .from('ad_spend')
    .select('id, spend_date, campaign, spend')
    .gte('spend_date', from)
    .lte('spend_date', to)
    .is('campaign_id', null)

  const overlaps = (manualRows || []).filter((m) =>
    adSpendRows.some((r) => r.spend_date === m.spend_date)
  )

  return Response.json({
    synced: adSpendRows.length,
    manual_rows_in_range: overlaps,
    duplicate_warning: overlaps.length > 0
      ? `${overlaps.length} manually-entered ad spend row(s) sit on dates this sync just wrote. They are counted in addition to the synced spend — delete them to avoid double-counting.`
      : null,
  })
}
