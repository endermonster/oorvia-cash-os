export async function POST(request) {
  let body
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { from, to } = body
  if (!from || !to) {
    return Response.json({ error: 'from and to (YYYY-MM-DD) are required' }, { status: 400 })
  }

  let orders
  try {
    const n8nRes = await fetch('https://n8n.oorvia.com/webhook/shopify-pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    })
    if (!n8nRes.ok) {
      const text = await n8nRes.text()
      return Response.json({ error: `Shopify fetch failed (${n8nRes.status}): ${text}` }, { status: 502 })
    }
    const data = await n8nRes.json()
    orders = Array.isArray(data?.orders) ? data.orders : Array.isArray(data) ? data : []
  } catch (e) {
    return Response.json({ error: `n8n unreachable: ${e.message}` }, { status: 502 })
  }

  if (orders.length === 0) {
    return Response.json({ fetched: 0, inserted: 0, updated: 0, message: 'No orders in date range' })
  }

  const origin = new URL(request.url).origin
  const syncRes = await fetch(`${origin}/api/sync/shopify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SYNC_SECRET}`,
    },
    body: JSON.stringify({ orders }),
  })

  const result = await syncRes.json()
  const warnings = result.warnings || []
  if (orders.length === 250) warnings.push('Shopify returned exactly 250 orders — there may be more. Narrow the date range.')

  return Response.json({ fetched: orders.length, ...result, warnings })
}
