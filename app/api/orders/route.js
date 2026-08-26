import { supabase } from '@/lib/supabase'
import { selectAll, selectAllIn } from '@/lib/paged'
import { monthRange } from '@/lib/dates'
import { ORDER_STATUS, ORDER_STATUS_LIST, PAYMENT_TYPE, PREPAID_TYPES, isValidOrderStatus } from '@/lib/constants'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const month       = searchParams.get('month') // YYYY-MM
  const status      = searchParams.get('status')
  const paymentMode = searchParams.get('paymentMode')

  // An unknown status used to fall through to `.eq()` and return an empty array,
  // which reads as "no orders" rather than "bad filter".
  if (status && !isValidOrderStatus(status)) {
    return Response.json(
      { error: `Unknown status '${status}'. Valid values: ${ORDER_STATUS_LIST.join(', ')}` },
      { status: 400 }
    )
  }

  // Callers (the ad-spend and RTO pages) total these rows, so the read must be
  // complete — an unbounded select truncates at the PostgREST row cap.
  try {
    const rows = await selectAll(() => {
      let q = supabase
        .from('orders')
        .select('*')
        .order('order_date', { ascending: false })

      if (month) {
        const { from, to } = monthRange(month)
        q = q.gte('order_date', from).lte('order_date', to)
      }
      if (status) q = q.eq('status', status)
      if (paymentMode === 'cod')          q = q.eq('payment_type', PAYMENT_TYPE.COD)
      else if (paymentMode === 'prepaid') q = q.in('payment_type', PREPAID_TYPES)

      return q
    })
    return Response.json(await withNetProfit(rows))
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// Attaches a REAL per-order net profit.
//
// The Orders table used to compute this in the browser from checkout_fee,
// cod_fee, rto_fee and six other columns that do not exist on `orders` — every
// deduction resolved to zero, so the column printed the order value and called
// it profit. Costs live in order_costs now, so the figure has to come from here.
//
//   net = revenue (delivered only) − variable costs (order_costs debits) − COGS
//
// Revenue and COGS are net of GST. Costs are taxable amounts, GST excluded,
// because that GST is reclaimed as input credit.
async function withNetProfit(orders) {
  if (orders.length === 0) return orders

  const names = orders.map((o) => o.shopify_order_name).filter(Boolean)
  if (names.length === 0) return orders

  const [costRows, lineItems] = await Promise.all([
    selectAllIn(
      (chunk) => supabase.from('order_costs')
        .select('shopify_order_name, taxable_amt')
        .in('shopify_order_name', chunk).eq('nature', 'debit'),
      names
    ),
    selectAllIn(
      (chunk) => supabase.from('order_line_items')
        .select('shopify_order_name, sku, qty, unit_price')
        .in('shopify_order_name', chunk),
      names
    ),
  ])

  const skus = [...new Set(lineItems.map((li) => li.sku).filter(Boolean))]
  const products = skus.length
    ? await selectAllIn(
        (chunk) => supabase.from('products').select('sku, current_cogs, gst_percentage').in('sku', chunk),
        skus
      )
    : []
  const productMap = Object.fromEntries(products.map((p) => [p.sku, p]))

  const costByOrder = {}
  for (const c of costRows) {
    costByOrder[c.shopify_order_name] = (costByOrder[c.shopify_order_name] || 0) + Number(c.taxable_amt || 0)
  }

  const cogsByOrder = {}
  const missingCogsSkus = new Set()
  for (const li of lineItems) {
    const p = li.sku ? productMap[li.sku] : null
    const unit = Number(p?.current_cogs ?? 0)
    if (!li.sku || !p || !(unit > 0)) missingCogsSkus.add(li.sku || '(no sku)')
    cogsByOrder[li.shopify_order_name] = (cogsByOrder[li.shopify_order_name] || 0) + unit * Number(li.qty || 0)
  }

  const r2 = (n) => Math.round(n * 100) / 100

  return orders.map((o) => {
    const name  = o.shopify_order_name
    const lines = lineItems.filter((li) => li.shopify_order_name === name)
    // Net-of-GST revenue at each line's own product rate, scaled onto order_value.
    const gross = Number(o.order_value || 0)
    let revenueNet = 0
    if (o.status === ORDER_STATUS.DELIVERED && gross > 0) {
      const lineGross = lines.reduce((s, li) => s + Number(li.unit_price || 0) * Number(li.qty || 0), 0)
      if (lineGross > 0) {
        for (const li of lines) {
          const rate  = Number(productMap[li.sku]?.gst_percentage)
          const r     = Number.isFinite(rate) && rate >= 0 ? rate : 18
          const share = (Number(li.unit_price || 0) * Number(li.qty || 0)) / lineGross
          revenueNet += (gross * share) / (1 + r / 100)
        }
      } else {
        revenueNet = gross / 1.18
      }
    }

    const variableCosts = costByOrder[name] || 0
    const cogs          = cogsByOrder[name] || 0
    const hasUnknownCogs = lines.length === 0 ||
      lines.some((li) => !li.sku || !(Number(productMap[li.sku]?.current_cogs) > 0))

    return {
      ...o,
      revenue_net:     r2(revenueNet),
      variable_costs:  r2(variableCosts),
      cogs:            r2(cogs),
      net_profit:      r2(revenueNet - variableCosts - cogs),
      // The UI must not present a confident number when COGS is unknown —
      // that is exactly how the old column lied.
      net_profit_is_partial: hasUnknownCogs,
    }
  })
}

// POST removed. Orders are created only by /api/sync/shopify and
// /api/import/vfulfill. The old handler wrote shopify_order_id, payment_mode,
// checkout_fee, cod_fee and six other columns that do not exist on `orders`
// (PK is shopify_order_name, the column is payment_type), so every call 500'd.
// Status corrections go through PATCH /api/orders/[id].
