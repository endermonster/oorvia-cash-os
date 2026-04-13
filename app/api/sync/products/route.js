import { supabase } from '@/lib/supabase'

// Convert Shopify weight to grams
function toGrams(value, unit) {
  const v = parseFloat(value) || 0
  switch ((unit || '').toLowerCase()) {
    case 'kg': return Math.round(v * 1000)
    case 'lb': return Math.round(v * 453.592)
    case 'oz': return Math.round(v * 28.3495)
    default: return Math.round(v) // already grams
  }
}

export async function POST(request) {
  const secret = process.env.SYNC_SECRET
  if (secret) {
    const auth = request.headers.get('authorization') || ''
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Shopify returns { products: [...] }, each product has variants[]
  const rawProducts = body?.products
  if (!Array.isArray(rawProducts) || rawProducts.length === 0) {
    return Response.json({ synced: 0, message: 'No products in payload' })
  }

  // Flatten products → one row per variant (each variant has its own SKU)
  const variants = []
  for (const p of rawProducts) {
    for (const v of p.variants || []) {
      if (!v.sku) continue // skip variants without a SKU
      const title =
        p.variants.length === 1 || v.title === 'Default Title'
          ? p.title
          : `${p.title} — ${v.title}`
      variants.push({
        sku: v.sku,
        name: title,
        selling_price: parseFloat(v.price) || 0,
        category: p.product_type || null,
        weight_grams: toGrams(v.weight, v.weight_unit),
      })
    }
  }

  if (variants.length === 0) {
    return Response.json({ synced: 0, message: 'No variants with SKUs found' })
  }

  // Fetch existing products so we don't overwrite manually-set COGS
  const skus = variants.map((v) => v.sku)
  const { data: existing } = await supabase
    .from('products')
    .select('sku, cogs')
    .in('sku', skus)
  const cogsMap = new Map((existing || []).map((p) => [p.sku, p.cogs]))

  // Merge: preserve existing COGS, default to 0 for new products
  const rows = variants.map((v) => ({
    ...v,
    cogs: cogsMap.has(v.sku) ? cogsMap.get(v.sku) : 0,
  }))

  const { error } = await supabase
    .from('products')
    .upsert(rows, { onConflict: 'sku' })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ synced: rows.length })
}
