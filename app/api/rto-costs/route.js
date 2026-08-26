import { supabase } from '@/lib/supabase'
import { selectAllIn } from '@/lib/paged'
import { COST_SOURCE } from '@/lib/constants'

// Transaction heads that are charged even when an order RTOs.
// COD Fees are intentionally excluded — vFulfill does not charge them on RTOs.
const RTO_COST_HEADS = new Set([
  'forward shipping',
  'fulfilment fees',
  'fulfillment fees',
  'order managment fee',
  'order management fee',
  'convenience fees percentage',
  'rto handling fee',
  'rto shipping',
])

// GET /api/rto-costs?names=OV1234,OV1235,...
// Returns { [shopify_order_name]: totalCost } for each order.
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const namesParam = searchParams.get('names')
  if (!namesParam) return Response.json({})

  const names = namesParam.split(',').map((n) => n.trim()).filter(Boolean)
  if (names.length === 0) return Response.json({})

  // order_costs carries ~5 rows per order, so a month of order names blows past
  // both the row cap and the URL length limit on a plain .in() — chunk and page.
  let data
  try {
    data = await selectAllIn(
      (chunk) =>
        supabase
          .from('order_costs')
          .select('shopify_order_name, transaction_head, total_amt')
          .in('shopify_order_name', chunk)
          .eq('source', COST_SOURCE.VFULFILL)
          .eq('nature', 'debit'),
      names
    )
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }

  const result = {}
  for (const row of data) {
    if (!RTO_COST_HEADS.has((row.transaction_head || '').toLowerCase().trim())) continue
    const name = row.shopify_order_name
    result[name] = Math.round(((result[name] || 0) + Number(row.total_amt)) * 100) / 100
  }

  return Response.json(result)
}
