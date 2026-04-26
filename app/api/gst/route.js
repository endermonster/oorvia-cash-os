import { supabase } from '@/lib/supabase'

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

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month') // YYYY-MM
  if (!month) return Response.json({ error: 'month param required' }, { status: 400 })

  const [y, m] = month.split('-').map(Number)
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const end   = new Date(y, m, 0).toISOString().slice(0, 10)

  // Fetch all non-cancelled orders for the month
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('shopify_order_name, status, payment_type, order_value, order_date, ship_state')
    .gte('order_date', start)
    .lte('order_date', end)
    .neq('status', 'cancelled')

  if (ordersErr) return Response.json({ error: ordersErr.message }, { status: 500 })

  const allOrders       = orders || []
  const allOrderNames   = allOrders.map(o => o.shopify_order_name)
  const deliveredOrders = allOrders.filter(o => o.status === 'delivered')

  // Fetch order costs (fees with GST amounts) for ITC — broken down by source
  let costRows = []
  if (allOrderNames.length > 0) {
    const { data, error } = await supabase
      .from('order_costs')
      .select('shopify_order_name, source, gst_amt')
      .in('shopify_order_name', allOrderNames)
      .eq('nature', 'debit')
    if (error) return Response.json({ error: error.message }, { status: 500 })
    costRows = data || []
  }

  // Fetch ad spend for meta ads ITC (ad_spend.spend is net; GST = spend × 18%)
  const { data: marketing, error: mktErr } = await supabase
    .from('ad_spend')
    .select('spend, spend_date')
    .gte('spend_date', start)
    .lte('spend_date', end)
  if (mktErr) return Response.json({ error: mktErr.message }, { status: 500 })

  // Fetch manual GST entries — soft error: gst_entries may not exist in all schema versions
  let manualEntries = []
  const { data: manualData } = await supabase
    .from('gst_entries')
    .select('*')
    .eq('entry_month', start)
    .order('created_at', { ascending: false })
  if (manualData) manualEntries = manualData

  // ── OTC Calculation ────────────────────────────────────────────────────────
  // Only on DELIVERED orders. Default GST rate 18% since v2 schema stores rate on products, not orders.
  const DEFAULT_GST_RATE = 18

  const otcOrders = deliveredOrders.map((o) => {
    const rate  = DEFAULT_GST_RATE
    const gst   = calcOTC(Number(o.order_value), rate)
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
  const itc3PL      = r2(costRows.filter(c => c.source === 'vfulfill').reduce((s, c) => s + Number(c.gst_amt), 0))
  const itcCheckout = r2(costRows.filter(c => c.source === 'fastrr').reduce((s, c) => s + Number(c.gst_amt), 0))
  const itcCashfree = r2(costRows.filter(c => c.source === 'cashfree').reduce((s, c) => s + Number(c.gst_amt), 0))
  const itcMetaAds  = r2((marketing || []).reduce((s, m) => s + Number(m.spend) * 0.18, 0))
  const itcManual   = r2(manualEntries.filter(e => e.type === 'itc').reduce((s, e) => s + Number(e.gst_amount), 0))
  const totalITC    = r2(itc3PL + itcCheckout + itcCashfree + itcMetaAds + itcManual)
  const netLiability = r2(totalOTC + manualOTC - totalITC)

  const adSpendTotal = r2((marketing || []).reduce((s, m) => s + Number(m.spend), 0))

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
      from_manual:     itcManual,
      total:           totalITC,
    },
    net_liability:  netLiability,
    manual_entries: manualEntries,
    ad_spend_total: adSpendTotal,
    order_count:    deliveredOrders.length,
  })
}
