import { supabase } from '@/lib/supabase'

// PATCH /api/orders/enrich
// Body: [{ shopify_order_id: string, customer_state: string }]
// Called by Make.com after fetching province from Shopify API.
// Updates customer_state on orders that were already imported from vFulfill.

export async function PATCH(request) {
  const body = await request.json()

  if (!Array.isArray(body) || body.length === 0) {
    return Response.json({ error: 'Expected a non-empty array' }, { status: 400 })
  }

  const errors = []
  let updated = 0

  for (const { shopify_order_id, customer_state } of body) {
    if (!shopify_order_id) continue

    const { error } = await supabase
      .from('orders')
      .update({ customer_state: customer_state || null })
      .eq('shopify_order_id', shopify_order_id)

    if (error) errors.push({ shopify_order_id, message: error.message })
    else updated++
  }

  return Response.json({ updated, errors })
}
