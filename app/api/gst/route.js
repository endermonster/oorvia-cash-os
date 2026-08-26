import { supabase } from '@/lib/supabase'
import { selectAll, selectAllIn } from '@/lib/paged'
import { addMonths, monthRange } from '@/lib/dates'
import {
  COST_SOURCE,
  GST_RATE_PCT,
  NON_DELIVERED_STATUSES,
  ORDER_STATUS,
} from '@/lib/constants'

function r2(n) { return Math.round(n * 100) / 100 }

// OTC = order_value × rate / (100 + rate)  [prices are GST-inclusive]
function calcOTC(price, rate) {
  return r2(price * rate / (100 + rate))
}

const SELLER_STATE      = 'MH'
const SELLER_STATE_FULL = 'MAHARASHTRA'

function isIntraState(shipState) {
  if (!shipState) return false
  const s = shipState.trim().toUpperCase()
  return s === SELLER_STATE || s === SELLER_STATE_FULL
}

// GST rate for a line item, from products.gst_percentage. Falls back to the
// default rate when the line has no SKU or the product is missing.
function gstRateFor(sku, productMap) {
  const rate = sku ? Number(productMap[sku]?.gst_percentage) : NaN
  return Number.isFinite(rate) && rate >= 0 ? rate : GST_RATE_PCT
}

// Output tax for one order, computed PER LINE ITEM at that product's own rate.
// Line totals rarely add up to order_value exactly (shipping, discounts), so the
// lines are scaled onto order_value — taxable + gst always reconstitutes it.
// Orders with no usable line items fall back to the whole order at the default rate.
function otcForOrder(order, lines, productMap) {
  const orderValue = Number(order.order_value) || 0
  const grossTotal = (lines || []).reduce((s, li) => s + Number(li.unit_price) * Number(li.qty), 0)

  if (!lines || lines.length === 0 || !(grossTotal > 0) || !(orderValue > 0)) {
    return { gst: calcOTC(orderValue, GST_RATE_PCT), rate: GST_RATE_PCT }
  }

  const scale = orderValue / grossTotal
  let gst = 0
  for (const li of lines) {
    const lineGross = Number(li.unit_price) * Number(li.qty) * scale
    gst += calcOTC(lineGross, gstRateFor(li.sku, productMap))
  }
  gst = r2(gst)
  const taxable = r2(orderValue - gst)
  return { gst, rate: taxable > 0 ? r2((gst / taxable) * 100) : GST_RATE_PCT }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month') // YYYY-MM
  if (!month) return Response.json({ error: 'month param required' }, { status: 400 })

  try {
    return await computeGST(month)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

async function computeGST(month) {
  const { from: start, to: end } = monthRange(month)

  const ORDER_COLS = 'shopify_order_name, status, payment_type, order_value, order_date, ship_state'

  // OTC is taxed in the month of delivery — filter delivered orders by delivered_at.
  // Fetch non-delivered orders by order_date for cost/ITC context. NON_DELIVERED_STATUSES
  // covers unfulfilled and cancelled too; hardcoding ['active','rto'] dropped their ITC.
  const [deliveredOrders, nonDeliveredOrders] = await Promise.all([
    selectAll(() =>
      supabase.from('orders').select(ORDER_COLS)
        .eq('status', ORDER_STATUS.DELIVERED)
        .gte('delivered_at', start).lte('delivered_at', end)
    ),
    selectAll(() =>
      supabase.from('orders').select(ORDER_COLS)
        .in('status', NON_DELIVERED_STATUSES)
        .gte('order_date', start).lte('order_date', end)
    ),
  ])

  const allOrders     = [...deliveredOrders, ...nonDeliveredOrders]
  const allOrderNames = allOrders.map(o => o.shopify_order_name)
  const deliveredNames = deliveredOrders.map(o => o.shopify_order_name)

  // Fetch order costs (fees with GST amounts) for ITC — broken down by source
  const costRows = await selectAllIn(
    (chunk) => supabase
      .from('order_costs')
      .select('shopify_order_name, source, gst_amt')
      .in('shopify_order_name', chunk)
      .eq('nature', 'debit'),
    allOrderNames
  )

  // Line items + product GST rates for per-SKU output tax
  const lineItems = await selectAllIn(
    (chunk) => supabase
      .from('order_line_items')
      .select('shopify_order_name, sku, qty, unit_price')
      .in('shopify_order_name', chunk),
    deliveredNames
  )
  const skus = [...new Set(lineItems.map(li => li.sku).filter(Boolean))]
  const productRows = await selectAllIn(
    (chunk) => supabase.from('products').select('sku, gst_percentage').in('sku', chunk),
    skus
  )
  const productMap = Object.fromEntries(productRows.map(p => [p.sku, p]))

  const lineItemsByOrder = {}
  for (const li of lineItems) {
    (lineItemsByOrder[li.shopify_order_name] ||= []).push(li)
  }

  // Fetch ad spend for meta ads ITC (ad_spend.spend is net; GST = spend × 18%)
  const marketing = await selectAll(() =>
    supabase.from('ad_spend').select('spend, spend_date')
      .gte('spend_date', start).lte('spend_date', end)
  )

  // Fetch vFulfill wallet-level GST (sourcing imports, inward fees, wallet service charges)
  const vfWallet = await selectAll(() =>
    supabase.from('wallet_transactions').select('gst_amt')
      .eq('wallet', 'vfulfill')
      .in('type', ['sourcing', 'service_fee'])
      .gte('date', start).lte('date', end)
  )

  // Manual GST entries — external purchases where GST was claimed outside the
  // normal scope of the business. Auto-derived ITC (3PL, checkout, gateway, Meta)
  // must never be entered here. Errors surface: a silent [] understates ITC.
  const manualEntries = await selectAll(() =>
    supabase.from('gst_entries').select('*')
      .eq('entry_month', start)
      .order('created_at', { ascending: false })
  )

  // ── OTC Calculation ────────────────────────────────────────────────────────
  // Only on DELIVERED orders, priced per line item at that product's GST rate.
  const otcOrders = deliveredOrders.map((o) => {
    const { gst, rate } = otcForOrder(o, lineItemsByOrder[o.shopify_order_name], productMap)
    const intra = isIntraState(o.ship_state)

    return {
      order_id:           o.shopify_order_name,
      shopify_order_name: o.shopify_order_name,
      order_date:         o.order_date,
      ship_state:         o.ship_state || null,
      order_value:        Number(o.order_value),
      gst_rate:           rate,
      taxable_value:      r2(Number(o.order_value) - gst),
      gst_amount:         gst,
      igst:               intra ? 0 : gst,
      cgst:               intra ? r2(gst / 2) : 0,
      sgst:               intra ? r2(gst / 2) : 0,
    }
  })

  const totalOTC  = r2(otcOrders.reduce((s, o) => s + o.gst_amount, 0))
  const totalIGST = r2(otcOrders.reduce((s, o) => s + o.igst, 0))
  const totalCGST = r2(otcOrders.reduce((s, o) => s + o.cgst, 0))
  const totalSGST = r2(otcOrders.reduce((s, o) => s + o.sgst, 0))
  const manualOTC = r2(manualEntries.filter(e => e.type === 'otc').reduce((s, e) => s + Number(e.gst_amount), 0))

  // ── ITC Calculation ────────────────────────────────────────────────────────
  // All ITC comes from gst_amt stored on each cost row or marketing row.
  const itc3PL      = r2(costRows.filter(c => c.source === COST_SOURCE.VFULFILL).reduce((s, c) => s + Number(c.gst_amt), 0))
  const itcCheckout = r2(costRows.filter(c => c.source === COST_SOURCE.FASTRR).reduce((s, c) => s + Number(c.gst_amt), 0))
  const itcCashfree = r2(costRows.filter(c => c.source === COST_SOURCE.CASHFREE).reduce((s, c) => s + Number(c.gst_amt), 0))
  const itcMetaAds  = r2(marketing.reduce((s, m) => s + Number(m.spend) * (GST_RATE_PCT / 100), 0))
  const itcVfWallet = r2(vfWallet.reduce((s, w) => s + Number(w.gst_amt || 0), 0))
  const itcManual   = r2(manualEntries.filter(e => e.type === 'itc').reduce((s, e) => s + Number(e.gst_amount), 0))
  const totalITC    = r2(itc3PL + itcCheckout + itcCashfree + itcMetaAds + itcVfWallet + itcManual)
  const netLiability = r2(totalOTC + manualOTC - totalITC)

  // ── Carry-Forward Calculation ──────────────────────────────────────────────
  let openingCF = 0
  let cfIsSeeded = false
  const { data: cfRow } = await supabase
    .from('gst_credit_ledger')
    .select('opening_balance, is_manual')
    .eq('month', month)
    .maybeSingle()
  if (cfRow) {
    openingCF = Number(cfRow.opening_balance || 0)
    cfIsSeeded = true
  }

  const adjustedNet  = r2(netLiability - openingCF)
  const taxPayable   = r2(Math.max(0, adjustedNet))
  const closingCF    = r2(Math.max(0, -adjustedNet))

  // Auto-propagate closing balance → next month's opening (skip if next month has a manual seed)
  // NOTE (B12): this is a write inside a GET. Known, deliberately left as-is.
  const nextMonth = addMonths(month, 1)
  const { data: nextCfRow } = await supabase
    .from('gst_credit_ledger')
    .select('is_manual')
    .eq('month', nextMonth)
    .maybeSingle()
  if (!nextCfRow?.is_manual) {
    await supabase.from('gst_credit_ledger')
      .upsert({ month: nextMonth, opening_balance: closingCF, is_manual: false }, { onConflict: 'month' })
  }

  const adSpendTotal = r2(marketing.reduce((s, m) => s + Number(m.spend), 0))

  return Response.json({
    period: { start, end, month },
    otc: {
      from_orders: totalOTC,
      from_manual: manualOTC,
      total:       r2(totalOTC + manualOTC),
      igst:        totalIGST,
      cgst:        totalCGST,
      sgst:        totalSGST,
      orders:      otcOrders,
    },
    itc: {
      from_3pl:        itc3PL,
      from_checkout:   itcCheckout,
      from_payment_gw: itcCashfree,
      from_meta_ads:   itcMetaAds,
      from_vf_wallet:  itcVfWallet,
      from_manual:     itcManual,
      total:           totalITC,
    },
    net_liability:  netLiability,
    carry_forward: {
      opening:    openingCF,
      closing:    closingCF,
      tax_payable: taxPayable,
      is_seeded:  cfIsSeeded,
    },
    manual_entries: manualEntries,
    ad_spend_total: adSpendTotal,
    order_count:    deliveredOrders.length,
  })
}
