import { supabase } from '@/lib/supabase'
import { selectAll } from '@/lib/paged'

function r2(n) { return Math.round(n * 100) / 100 }

export async function GET() {
  // ad_spend is one row per campaign per day across all time — this aggregate
  // reads every one of them, so it must page or the totals under-report.
  let spendRows, maps
  try {
    ;[spendRows, maps] = await Promise.all([
      selectAll(() =>
        supabase.from('ad_spend').select('campaign_id, campaign, spend').not('campaign_id', 'is', null)
      ),
      selectAll(() => supabase.from('campaign_sku_map').select('campaign_id, sku, campaign_name')),
    ])
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }

  const mapById = Object.fromEntries(maps.map(m => [m.campaign_id, m.sku]))

  const agg = {}
  for (const row of spendRows) {
    if (!row.campaign_id) continue
    if (!agg[row.campaign_id]) {
      agg[row.campaign_id] = { campaign_id: row.campaign_id, campaign_name: row.campaign, total_spend: 0 }
    }
    agg[row.campaign_id].total_spend = r2(agg[row.campaign_id].total_spend + Number(row.spend || 0))
  }

  const result = Object.values(agg)
    .map(c => ({ ...c, sku: mapById[c.campaign_id] || null }))
    .sort((a, b) => b.total_spend - a.total_spend)

  return Response.json(result)
}

export async function POST(request) {
  const { campaign_id, sku, campaign_name } = await request.json()
  if (!campaign_id || !sku) return Response.json({ error: 'campaign_id and sku required' }, { status: 400 })

  const { data, error } = await supabase
    .from('campaign_sku_map')
    .upsert({ campaign_id, sku, campaign_name: campaign_name || null }, { onConflict: 'campaign_id' })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function DELETE(request) {
  const { campaign_id } = await request.json()
  if (!campaign_id) return Response.json({ error: 'campaign_id required' }, { status: 400 })

  const { error } = await supabase.from('campaign_sku_map').delete().eq('campaign_id', campaign_id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
