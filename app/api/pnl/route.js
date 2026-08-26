import { supabase } from '@/lib/supabase'
import { selectAll, selectAllIn } from '@/lib/paged'
import { daysBetweenInclusive, daysInMonth, monthEnd, monthStart, monthsBetween } from '@/lib/dates'
import {
  GST_RATE_PCT,
  NON_DELIVERED_STATUSES,
  ORDER_STATUS,
  PAYMENT_TYPE,
  PREPAID_TYPES,
} from '@/lib/constants'

function r2(n) { return Math.round(n * 100) / 100 }

const DEFAULT_DIVISOR = 1 + GST_RATE_PCT / 100

function daysInYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365
}

function cogsAt(sku, date, history, productMap) {
  const match = history
    .filter(h => h.sku === sku && h.effective_from <= date && (h.effective_to === null || h.effective_to > date))
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]
  return match ? Number(match.cogs) : Number(productMap[sku]?.current_cogs ?? 0)
}

// GST rate for a line item, from the product catalogue. Falls back to the
// default rate when the line has no SKU or the product is missing.
function gstRateFor(sku, productMap) {
  const rate = sku ? Number(productMap[sku]?.gst_percentage) : NaN
  return Number.isFinite(rate) && rate >= 0 ? rate : GST_RATE_PCT
}

// Divisor that turns a GST-inclusive order value into net revenue, blended
// across the order's line items at each product's own rate. Orders with no
// usable line items fall back to the default rate.
function netDivisorFor(orderName, lineItemsByOrder, productMap) {
  const lines = lineItemsByOrder[orderName]
  if (!lines || lines.length === 0) return DEFAULT_DIVISOR
  let gross = 0
  let net   = 0
  for (const li of lines) {
    const g = Number(li.unit_price) * Number(li.qty)
    if (!(g > 0)) continue
    gross += g
    net   += g / (1 + gstRateFor(li.sku, productMap) / 100)
  }
  if (!(gross > 0) || !(net > 0)) return DEFAULT_DIVISOR
  return gross / net
}

// Prorates a recurring cost across the requested range using REAL day counts:
// each overlapping month is divided by that month's own length (28–31), and
// yearly costs by that year's own length (365 or 366). A blanket /30 or /365
// over-bills every 31-day month by 3.3%.
function prorateFixedCost(fc, from, to, usdInrRate) {
  const overlapStart = fc.start_date > from ? fc.start_date : from
  const overlapEnd   = (!fc.end_date || fc.end_date > to) ? to : fc.end_date
  if (overlapStart > overlapEnd) return 0

  let amount = fc.usd_amount && usdInrRate ? r2(Number(fc.usd_amount) * usdInrRate) : Number(fc.amount)
  if (fc.gst_inclusive) amount = r2(amount / DEFAULT_DIVISOR)

  if (fc.frequency === 'one-time') return fc.start_date >= from && fc.start_date <= to ? amount : 0

  if (fc.frequency === 'monthly' || fc.frequency === 'yearly') {
    let total = 0
    for (const ym of monthsBetween(overlapStart.slice(0, 7), overlapEnd.slice(0, 7))) {
      const segStart = monthStart(ym) > overlapStart ? monthStart(ym) : overlapStart
      const segEnd   = monthEnd(ym)   < overlapEnd   ? monthEnd(ym)   : overlapEnd
      if (segStart > segEnd) continue
      const days    = daysBetweenInclusive(segStart, segEnd)
      const divisor = fc.frequency === 'monthly' ? daysInMonth(ym) : daysInYear(Number(ym.slice(0, 4)))
      total += amount * days / divisor
    }
    return r2(total)
  }

  // Fail loudly. A silent 0 here quietly removes a real cost from the P&L.
  throw new Error(`Unsupported fixed cost frequency '${fc.frequency}' on fixed cost '${fc.name || fc.id}'`)
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to   = searchParams.get('to')
  if (!from || !to) return Response.json({ error: 'from and to params required (YYYY-MM-DD)' }, { status: 400 })

  try {
    return await computePnL(from, to)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// Every read below goes through selectAll/selectAllIn. An unpaginated select
// here truncates at the PostgREST row cap, which understates costs and
// overstates profit without raising an error.
async function computePnL(from, to) {
  const ORDER_COLS = 'shopify_order_name, payment_type, order_value, order_date, delivered_at, status'

  // Delivered orders: filter by delivered_at (delivery date) for correct GST period accounting.
  // Everything else: filter by order_date for operational counts. NON_DELIVERED_STATUSES
  // covers unfulfilled and cancelled too — hardcoding ['active','rto'] here made those
  // orders and their costs invisible to the whole report.
  const [deliveredOrders, nonDelivered] = await Promise.all([
    selectAll(() =>
      supabase.from('orders').select(ORDER_COLS)
        .eq('status', ORDER_STATUS.DELIVERED)
        .gte('delivered_at', from).lte('delivered_at', to)
    ),
    selectAll(() =>
      supabase.from('orders').select(ORDER_COLS)
        .in('status', NON_DELIVERED_STATUSES)
        .gte('order_date', from).lte('order_date', to)
    ),
  ])

  const allOrders = [...deliveredOrders, ...nonDelivered]
  const orderNames      = allOrders.map(o => o.shopify_order_name)
  const deliveredNames  = deliveredOrders.map(o => o.shopify_order_name)
  const orderMap        = Object.fromEntries(allOrders.map(o => [o.shopify_order_name, o]))

  const costRows = await selectAllIn(
    (chunk) => supabase
      .from('order_costs')
      .select('shopify_order_name, transaction_head, taxable_amt, gst_amt, source')
      .in('shopify_order_name', chunk).eq('nature', 'debit'),
    orderNames
  )

  const lineItems = await selectAllIn(
    (chunk) => supabase
      .from('order_line_items')
      .select('shopify_order_name, sku, qty, unit_price')
      .in('shopify_order_name', chunk),
    deliveredNames
  )

  const skus = [...new Set(lineItems.map(li => li.sku).filter(Boolean))]
  const [cogsHistory, productRows] = await Promise.all([
    selectAllIn(
      (chunk) => supabase.from('cogs_history').select('sku, cogs, effective_from, effective_to').in('sku', chunk),
      skus
    ),
    selectAllIn(
      (chunk) => supabase.from('products').select('sku, name, current_cogs, gst_percentage').in('sku', chunk),
      skus
    ),
  ])
  const productMap = Object.fromEntries(productRows.map(p => [p.sku, p]))

  const lineItemsByOrder = {}
  for (const li of lineItems) {
    (lineItemsByOrder[li.shopify_order_name] ||= []).push(li)
  }

  const allFixed   = await selectAll(() => supabase.from('fixed_costs').select('*'))
  const fixedCosts = allFixed.filter(fc => fc.start_date <= to && (!fc.end_date || fc.end_date >= from))

  let usdInrRate = null
  if (fixedCosts.some(fc => fc.usd_amount)) {
    const month        = from.slice(0, 7)
    const now          = new Date()
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    const { data: locked } = await supabase.from('usd_inr_rates').select('rate').eq('month', month).single()
    if (locked) {
      usdInrRate = Number(locked.rate)
    } else {
      try {
        const lastDayOfMonth = daysInMonth(month)
        const chargeDate     = `${month}-${String(Math.min(30, lastDayOfMonth)).padStart(2, '0')}`
        const fxRes          = await fetch(`https://api.frankfurter.app/${chargeDate}?from=USD&to=INR`)
        const fxData         = await fxRes.json()
        usdInrRate           = fxData.rates?.INR || 84
      } catch {
        usdInrRate = 84
      }
      if (month < currentMonth) {
        await supabase.from('usd_inr_rates').upsert({ month, rate: usdInrRate })
      }
    }
  }

  const [marketing, campaignMapRows] = await Promise.all([
    selectAll(() =>
      supabase.from('ad_spend').select('spend, spend_date, campaign_id')
        .gte('spend_date', from).lte('spend_date', to)
    ),
    selectAll(() => supabase.from('campaign_sku_map').select('campaign_id, sku')),
  ])
  const campaignSkuMap = Object.fromEntries(campaignMapRows.map(m => [m.campaign_id, m.sku]))

  // ── Revenue ──
  // Net revenue is derived per order at the blended rate of its own line items,
  // not a flat /1.18 — a 5% or 12% SKU would otherwise be understated.
  const orderNetRevenue = {}
  for (const o of deliveredOrders) {
    orderNetRevenue[o.shopify_order_name] =
      Number(o.order_value) / netDivisorFor(o.shopify_order_name, lineItemsByOrder, productMap)
  }
  const revenue_gross = r2(deliveredOrders.reduce((s, o) => s + Number(o.order_value), 0))
  const revenue_net   = r2(deliveredOrders.reduce((s, o) => s + orderNetRevenue[o.shopify_order_name], 0))

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

  const fixed_costs_prorated = r2(fixedCosts.reduce((s, fc) => s + prorateFixedCost(fc, from, to, usdInrRate), 0))
  const marketing_net        = r2(marketing.reduce((s, m) => s + Number(m.spend || 0), 0))
  const marketing_gst        = r2(marketing.reduce((s, m) => s + Number(m.spend || 0) * (GST_RATE_PCT / 100), 0))
  const net_profit           = r2(revenue_net - variable_costs - total_cogs - fixed_costs_prorated - marketing_net)
  const margin_pct           = revenue_net > 0 ? r2((net_profit / revenue_net) * 100) : 0
  const total_itc            = r2(r2(inputGstFromCosts) + marketing_gst)

  // ── Per-order cost totals for SKU attribution ──
  // Every debit in order_costs and nothing else. The Cashfree gateway fee used to
  // be synthesised here at 2.5%, which double-counted against the headline: it now
  // arrives as a real order_costs row with source = COST_SOURCE.CASHFREE, written
  // by the Shopify sync, so it is counted exactly once in both figures.
  const orderCostTotal = {}
  for (const c of costRows) {
    orderCostTotal[c.shopify_order_name] = (orderCostTotal[c.shopify_order_name] || 0) + Number(c.taxable_amt)
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
    const gstRate  = gstRateFor(li.sku, productMap)

    if (!skuAgg[li.sku]) skuAgg[li.sku] = { sku: li.sku, name: productMap[li.sku]?.name || li.sku, gst_rate: gstRate, units: 0, revenue_net: 0, cogs: 0, allocated_costs: 0 }
    skuAgg[li.sku].units           += Number(li.qty)
    skuAgg[li.sku].revenue_net     += lineRev / (1 + gstRate / 100)
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

  // The date field each order was SELECTED on. Bucketing by anything else is what
  // let a single-month range emit two by_month rows: delivered orders were pulled
  // by delivered_at but bucketed by order_date.
  const basisOf   = (o) => (o.status === ORDER_STATUS.DELIVERED ? 'delivered_at' : 'order_date')
  const basisDate = (o) => (o.status === ORDER_STATUS.DELIVERED ? (o.delivered_at || o.order_date) : o.order_date)
  const settleBasis = (set) => (set.size === 1 ? [...set][0] : 'mixed')

  // ── By payment type ──
  // Full-range, exactly like the headline: every order in range opens a bucket, so
  // every cost row and every line item lands in one. That is what makes the column
  // totals tie back to headline variable_costs and cogs.
  const ptAgg   = {}
  const ptBasis = {}
  const ptKey   = (o) => o.payment_type || PAYMENT_TYPE.UNKNOWN
  for (const o of allOrders) {
    const pt = ptKey(o)
    if (!ptAgg[pt]) {
      ptAgg[pt]   = { type: pt, count: 0, order_count: 0, revenue_net: 0, variable_costs: 0, cogs: 0 }
      ptBasis[pt] = new Set()
    }
    ptBasis[pt].add(basisOf(o))
    ptAgg[pt].order_count++
    if (o.status === ORDER_STATUS.DELIVERED) {
      ptAgg[pt].count++
      ptAgg[pt].revenue_net += orderNetRevenue[o.shopify_order_name]
    }
  }
  for (const c of costRows) {
    const o = orderMap[c.shopify_order_name]
    if (!o) continue
    ptAgg[ptKey(o)].variable_costs += Number(c.taxable_amt)
  }
  for (const li of lineItems) {
    if (!li.sku) continue
    const o = orderMap[li.shopify_order_name]
    if (!o) continue
    ptAgg[ptKey(o)].cogs += Number(li.qty) * cogsAt(li.sku, o.order_date, cogsHistory, productMap)
  }
  const by_payment_type = Object.values(ptAgg).map(pt => ({
    ...pt,
    basis:          settleBasis(ptBasis[pt.type]),
    revenue_net:    r2(pt.revenue_net),
    variable_costs: r2(pt.variable_costs),
    cogs:           r2(pt.cogs),
    net:            r2(pt.revenue_net - pt.variable_costs - pt.cogs),
    margin_pct:     pt.revenue_net > 0 ? r2(((pt.revenue_net - pt.variable_costs - pt.cogs) / pt.revenue_net) * 100) : 0,
  })).sort((a, b) => b.revenue_net - a.revenue_net)

  // ── By month ──
  // Same full-range rule, bucketed by the field the row was selected on.
  const monthAgg   = {}
  const monthBasis = {}
  const monthKey   = (o) => String(basisDate(o)).slice(0, 7)
  for (const o of allOrders) {
    const m = monthKey(o)
    if (!monthAgg[m]) {
      monthAgg[m]   = { month: m, count: 0, order_count: 0, revenue_net: 0, variable_costs: 0, cogs: 0 }
      monthBasis[m] = new Set()
    }
    monthBasis[m].add(basisOf(o))
    monthAgg[m].order_count++
    if (o.status === ORDER_STATUS.DELIVERED) {
      monthAgg[m].count++
      monthAgg[m].revenue_net += orderNetRevenue[o.shopify_order_name]
    }
  }
  for (const c of costRows) {
    const o = orderMap[c.shopify_order_name]
    if (!o) continue
    monthAgg[monthKey(o)].variable_costs += Number(c.taxable_amt)
  }
  for (const li of lineItems) {
    if (!li.sku) continue
    const o = orderMap[li.shopify_order_name]
    if (!o) continue
    monthAgg[monthKey(o)].cogs += Number(li.qty) * cogsAt(li.sku, o.order_date, cogsHistory, productMap)
  }
  const by_month = Object.values(monthAgg)
    .map(m => ({
      ...m,
      basis:          settleBasis(monthBasis[m.month]),
      revenue_net:    r2(m.revenue_net),
      variable_costs: r2(m.variable_costs),
      cogs:           r2(m.cogs),
    }))
    .sort((a, b) => a.month.localeCompare(b.month))

  return Response.json({
    from, to,
    revenue_gross, revenue_net, variable_costs, cogs: total_cogs,
    fixed_costs_prorated, marketing_net, net_profit, margin_pct, total_itc,
    orders: {
      total:       allOrders.length,
      delivered:   deliveredOrders.length,
      rto:         allOrders.filter(o => o.status === ORDER_STATUS.RTO).length,
      active:      allOrders.filter(o => o.status === ORDER_STATUS.ACTIVE).length,
      unfulfilled: allOrders.filter(o => o.status === ORDER_STATUS.UNFULFILLED).length,
      cancelled:   allOrders.filter(o => o.status === ORDER_STATUS.CANCELLED).length,
      cod:         allOrders.filter(o => o.payment_type === PAYMENT_TYPE.COD).length,
      prepaid:     allOrders.filter(o => PREPAID_TYPES.includes(o.payment_type)).length,
    },
    cost_by_head: costByHead, by_sku, by_payment_type, by_month,
    // Headline figures the breakdown tabs must add up to. by_payment_type and
    // by_month are full-range (all statuses); by_sku is delivered-only and is
    // split proportionally by line revenue, so it reconciles on cost, not revenue.
    reconciliation: {
      revenue_gross,
      revenue_net,
      variable_costs,
      cogs: total_cogs,
      order_count: allOrders.length,
      tabs: {
        by_payment_type: ['revenue_net', 'variable_costs', 'cogs'],
        by_month:        ['revenue_net', 'variable_costs', 'cogs'],
      },
    },
  })
}
