import { supabase } from '@/lib/supabase'

function r2(n) { return Math.round(n * 100) / 100 }

function cogsAt(sku, date, history, productMap) {
  const match = history
    .filter(h => h.sku === sku && h.effective_from <= date && (h.effective_to === null || h.effective_to > date))
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]
  return match ? Number(match.cogs) : Number(productMap[sku]?.current_cogs ?? 0)
}

function prorateFixedCost(fc, from, to) {
  const overlapStart = fc.start_date > from ? fc.start_date : from
  const overlapEnd   = (!fc.end_date || fc.end_date > to) ? to : fc.end_date
  if (overlapStart > overlapEnd) return 0
  const days   = (new Date(overlapEnd) - new Date(overlapStart)) / 86400000 + 1
  let amount   = Number(fc.amount)
  if (fc.gst_inclusive) amount = r2(amount / 1.18)
  if (fc.frequency === 'one-time') return fc.start_date >= from && fc.start_date <= to ? amount : 0
  if (fc.frequency === 'monthly')  return r2(amount * days / 30)
  if (fc.frequency === 'yearly')   return r2(amount * days / 365)
  return 0
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to   = searchParams.get('to')
  if (!from || !to) return Response.json({ error: 'from and to params required (YYYY-MM-DD)' }, { status: 400 })

  // Delivered orders: filter by delivered_at (delivery date) for correct GST period accounting.
  // Active/RTO orders: filter by order_date for operational counts.
  const [deliveredRes, nonDeliveredRes] = await Promise.all([
    supabase.from('orders')
      .select('shopify_order_name, payment_type, order_value, order_date, status')
      .eq('status', 'delivered')
      .gte('delivered_at', from).lte('delivered_at', to),
    supabase.from('orders')
      .select('shopify_order_name, payment_type, order_value, order_date, status')
      .in('status', ['active', 'rto'])
      .gte('order_date', from).lte('order_date', to),
  ])
  if (deliveredRes.error)    return Response.json({ error: deliveredRes.error.message }, { status: 500 })
  if (nonDeliveredRes.error) return Response.json({ error: nonDeliveredRes.error.message }, { status: 500 })

  const deliveredOrders = deliveredRes.data || []
  const nonDelivered    = nonDeliveredRes.data || []
  const allOrders       = [...deliveredOrders, ...nonDelivered]
  const orderNames      = allOrders.map(o => o.shopify_order_name)
  const deliveredNames  = deliveredOrders.map(o => o.shopify_order_name)
  const orderMap        = Object.fromEntries(allOrders.map(o => [o.shopify_order_name, o]))

  let costRows = []
  if (orderNames.length > 0) {
    const { data, error } = await supabase
      .from('order_costs')
      .select('shopify_order_name, transaction_head, taxable_amt, gst_amt, source')
      .in('shopify_order_name', orderNames).eq('nature', 'debit')
    if (error) return Response.json({ error: error.message }, { status: 500 })
    costRows = data || []
  }

  let lineItems = []
  if (deliveredNames.length > 0) {
    const { data, error } = await supabase
      .from('order_line_items')
      .select('shopify_order_name, sku, qty, unit_price')
      .in('shopify_order_name', deliveredNames)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    lineItems = data || []
  }

  const skus = [...new Set(lineItems.map(li => li.sku).filter(Boolean))]
  let cogsHistory = [], productMap = {}
  if (skus.length > 0) {
    const [hRes, pRes] = await Promise.all([
      supabase.from('cogs_history').select('sku, cogs, effective_from, effective_to').in('sku', skus),
      supabase.from('products').select('sku, name, current_cogs').in('sku', skus),
    ])
    if (hRes.error) return Response.json({ error: hRes.error.message }, { status: 500 })
    cogsHistory = hRes.data || []
    productMap  = Object.fromEntries((pRes.data || []).map(p => [p.sku, p]))
  }

  const { data: allFixed } = await supabase.from('fixed_costs').select('*')
  const fixedCosts = (allFixed || []).filter(fc => fc.start_date <= to && (!fc.end_date || fc.end_date >= from))

  const [marketingRes, campaignMapRes] = await Promise.all([
    supabase.from('ad_spend').select('spend, spend_date, campaign_id').gte('spend_date', from).lte('spend_date', to),
    supabase.from('campaign_sku_map').select('campaign_id, sku'),
  ])
  const marketing       = marketingRes.data || []
  const campaignSkuMap  = Object.fromEntries((campaignMapRes.data || []).map(m => [m.campaign_id, m.sku]))

  // ── Revenue ──
  const revenue_net = r2(deliveredOrders.reduce((s, o) => s + Number(o.order_value) / 1.18, 0))

  // ── Variable costs ──
  const costByHead = {}
  let inputGstFromCosts = 0
  for (const c of costRows) {
    costByHead[c.transaction_head] = r2((costByHead[c.transaction_head] || 0) + Number(c.taxable_amt))
    inputGstFromCosts += Number(c.gst_amt)
  }
  const variable_costs = r2(Object.values(costByHead).reduce((s, v) => s + v, 0))

  // ── COGS ──
  let total_cogs = 0
  for (const li of lineItems) {
    if (!li.sku) continue
    const order = orderMap[li.shopify_order_name]
    if (!order) continue
    total_cogs += Number(li.qty) * cogsAt(li.sku, order.order_date, cogsHistory, productMap)
  }
  total_cogs = r2(total_cogs)

  const fixed_costs_prorated = r2(fixedCosts.reduce((s, fc) => s + prorateFixedCost(fc, from, to), 0))
  const marketing_net        = r2(marketing.reduce((s, m) => s + Number(m.spend || 0), 0))
  const marketing_gst        = r2(marketing.reduce((s, m) => s + Number(m.spend || 0) * 0.18, 0))
  const net_profit           = r2(revenue_net - variable_costs - total_cogs - fixed_costs_prorated - marketing_net)
  const margin_pct           = revenue_net > 0 ? r2((net_profit / revenue_net) * 100) : 0
  const total_itc            = r2(r2(inputGstFromCosts) + marketing_gst)

  // ── Per-order cost totals for SKU attribution ──
  // Includes: all order_costs debits (vFulfill + fastrr checkout)
  //         + Cashfree payment gateway fee (2.5% net of GST, prepaid_cashfree orders only)
  const orderCostTotal = {}
  for (const c of costRows) {
    orderCostTotal[c.shopify_order_name] = (orderCostTotal[c.shopify_order_name] || 0) + Number(c.taxable_amt)
  }
  for (const o of deliveredOrders) {
    if (o.payment_type === 'prepaid_cashfree') {
      orderCostTotal[o.shopify_order_name] = (orderCostTotal[o.shopify_order_name] || 0) + Number(o.order_value) * 0.025
    }
  }

  // Gross line revenue per order (pre-GST) used as the denominator for proportional splits
  const orderLineRevenue = {}
  for (const li of lineItems) {
    orderLineRevenue[li.shopify_order_name] = (orderLineRevenue[li.shopify_order_name] || 0) + Number(li.unit_price) * Number(li.qty)
  }

  // Meta spend per SKU via campaign_sku_map
  const skuMetaSpend = {}
  for (const s of marketing) {
    if (!s.campaign_id) continue
    const sku = campaignSkuMap[s.campaign_id]
    if (!sku) continue
    skuMetaSpend[sku] = (skuMetaSpend[sku] || 0) + Number(s.spend || 0)
  }

  // ── By SKU ──
  const skuAgg = {}
  for (const li of lineItems) {
    if (!li.sku) continue
    const order = orderMap[li.shopify_order_name]
    if (!order) continue
    const c        = cogsAt(li.sku, order.order_date, cogsHistory, productMap)
    const lineRev  = Number(li.unit_price) * Number(li.qty)
    const totalRev = orderLineRevenue[li.shopify_order_name] || lineRev
    const costFrac = totalRev > 0 ? lineRev / totalRev : 1

    if (!skuAgg[li.sku]) skuAgg[li.sku] = { sku: li.sku, name: productMap[li.sku]?.name || li.sku, units: 0, revenue_net: 0, cogs: 0, allocated_costs: 0 }
    skuAgg[li.sku].units           += Number(li.qty)
    skuAgg[li.sku].revenue_net     += lineRev / 1.18
    skuAgg[li.sku].cogs            += Number(li.qty) * c
    skuAgg[li.sku].allocated_costs += costFrac * (orderCostTotal[li.shopify_order_name] || 0)
  }

  const by_sku = Object.values(skuAgg).map(s => {
    const meta_spend     = r2(skuMetaSpend[s.sku] || 0)
    const net_profit_sku = r2(s.revenue_net - s.cogs - s.allocated_costs - meta_spend)
    return {
      ...s,
      revenue_net:     r2(s.revenue_net),
      cogs:            r2(s.cogs),
      gross_profit:    r2(s.revenue_net - s.cogs),
      margin_pct:      s.revenue_net > 0 ? r2(((s.revenue_net - s.cogs) / s.revenue_net) * 100) : 0,
      allocated_costs: r2(s.allocated_costs),
      meta_spend,
      net_profit:      net_profit_sku,
      net_margin_pct:  s.revenue_net > 0 ? r2((net_profit_sku / s.revenue_net) * 100) : 0,
    }
  }).sort((a, b) => b.revenue_net - a.revenue_net)

  // ── By payment type ──
  const ptAgg = {}
  for (const o of deliveredOrders) {
    const pt = o.payment_type
    if (!ptAgg[pt]) ptAgg[pt] = { type: pt, count: 0, revenue_net: 0, variable_costs: 0, cogs: 0 }
    ptAgg[pt].count++
    ptAgg[pt].revenue_net += Number(o.order_value) / 1.18
  }
  for (const c of costRows) {
    const o = orderMap[c.shopify_order_name]
    if (!o || o.status !== 'delivered') continue
    if (ptAgg[o.payment_type]) ptAgg[o.payment_type].variable_costs += Number(c.taxable_amt)
  }
  for (const li of lineItems) {
    if (!li.sku) continue
    const o = orderMap[li.shopify_order_name]
    if (!o) continue
    if (ptAgg[o.payment_type]) ptAgg[o.payment_type].cogs += Number(li.qty) * cogsAt(li.sku, o.order_date, cogsHistory, productMap)
  }
  const by_payment_type = Object.values(ptAgg).map(pt => ({
    ...pt,
    revenue_net:    r2(pt.revenue_net),
    variable_costs: r2(pt.variable_costs),
    cogs:           r2(pt.cogs),
    net:            r2(pt.revenue_net - pt.variable_costs - pt.cogs),
    margin_pct:     pt.revenue_net > 0 ? r2(((pt.revenue_net - pt.variable_costs - pt.cogs) / pt.revenue_net) * 100) : 0,
  })).sort((a, b) => b.revenue_net - a.revenue_net)

  // ── By month ──
  const monthAgg = {}
  for (const o of deliveredOrders) {
    const m = o.order_date.slice(0, 7)
    if (!monthAgg[m]) monthAgg[m] = { month: m, count: 0, revenue_net: 0, variable_costs: 0 }
    monthAgg[m].count++
    monthAgg[m].revenue_net += Number(o.order_value) / 1.18
  }
  for (const c of costRows) {
    const o = orderMap[c.shopify_order_name]
    if (!o || o.status !== 'delivered') continue
    const m = o.order_date.slice(0, 7)
    if (monthAgg[m]) monthAgg[m].variable_costs += Number(c.taxable_amt)
  }
  const by_month = Object.values(monthAgg)
    .map(m => ({ ...m, revenue_net: r2(m.revenue_net), variable_costs: r2(m.variable_costs) }))
    .sort((a, b) => a.month.localeCompare(b.month))

  return Response.json({
    from, to,
    revenue_net, variable_costs, cogs: total_cogs,
    fixed_costs_prorated, marketing_net, net_profit, margin_pct, total_itc,
    orders: {
      total:     allOrders.length,
      delivered: deliveredOrders.length,
      rto:       allOrders.filter(o => o.status === 'rto').length,
      active:    allOrders.filter(o => o.status === 'active').length,
      cod:       allOrders.filter(o => o.payment_type === 'cash_on_delivery').length,
      prepaid:   allOrders.filter(o => ['prepaid_cashfree','prepaid_razorpay'].includes(o.payment_type)).length,
    },
    cost_by_head: costByHead, by_sku, by_payment_type, by_month,
  })
}
