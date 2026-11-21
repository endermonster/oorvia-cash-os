import 'server-only'
import type { AdsCampaign, AdsMetaDay, AdsOrder } from './ads'
import { selectAll } from './paged'
import { supabase } from './supabase'
import type { Product, StoreId } from './types'

type Num = number | string
/** Campaign IDs per `.in()` read: keeps the URL short (PostgREST serialises the list into it). */
const CHUNK = 100

/**
 * The stores' campaigns, their Meta days in [from, to] (IST dates) and every counted Shopify order placed then.
 * A campaign sells the product in its store whose handle is its landing handle (renames already translated by
 * the Meta sync through cc_handle_aliases), as on Home.
 */
export async function loadAds(from: string, to: string, storeIds: StoreId[], products: Pick<Product, 'storeId' | 'sku' | 'handle'>[]): Promise<{
  campaigns: AdsCampaign[]; days: AdsMetaDay[]; orders: AdsOrder[]
}> {
  const sb = supabase()
  const [campRows, orderRows] = await Promise.all([
    selectAll<{ campaign_id: string; store_id: StoreId; ad_account_id: string | null; name: string; status: string | null; landing_handle: string | null }>(
      () => sb.from('cc_campaigns').select('campaign_id, store_id, ad_account_id, name, status, landing_handle').in('store_id', storeIds).order('campaign_id'),
    ),
    // cc_order_facts: one row per counted order (cancelled and test orders left out), dated in IST.
    selectAll<{ store_id: StoreId; order_name: string; date: string; campaign_id: string | null; total_paise: Num }>(
      () => sb.from('cc_order_facts').select('store_id, order_name, date, campaign_id, total_paise')
        .in('store_id', storeIds).gte('date', from).lte('date', to).order('store_id').order('order_name'),
    ),
  ])

  const campaigns: AdsCampaign[] = campRows.map((r) => ({
    id: r.campaign_id, storeId: r.store_id, adAccountId: r.ad_account_id, name: r.name, status: r.status,
    sku: products.find((p) => p.storeId === r.store_id && p.handle === r.landing_handle)?.sku ?? null,
  }))

  const ids = campaigns.map((c) => c.id)
  const days: AdsMetaDay[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const got = await selectAll<{ campaign_id: string; date: string; spend_paise: Num; impressions: Num; clicks: Num; purchases: Num | null }>(
      () => sb.from('cc_campaign_days').select('campaign_id, date, spend_paise, impressions, clicks, purchases')
        .in('campaign_id', ids.slice(i, i + CHUNK)).gte('date', from).lte('date', to).order('campaign_id').order('date'),
    )
    days.push(...got.map((r) => ({
      date: r.date, campaignId: r.campaign_id, spendPaise: Number(r.spend_paise), impressions: Number(r.impressions),
      clicks: Number(r.clicks), purchases: Number(r.purchases ?? 0),
    })))
  }

  // A campaign ID that names none of this store's campaigns (not synced, another account) counts as untracked.
  const known = new Set(campaigns.map((c) => `${c.storeId}|${c.id}`))
  const orders: AdsOrder[] = orderRows.map((r) => ({
    storeId: r.store_id, date: r.date, totalPaise: Number(r.total_paise),
    campaignId: r.campaign_id !== null && known.has(`${r.store_id}|${r.campaign_id}`) ? r.campaign_id : null,
  }))
  return { campaigns, days, orders }
}
