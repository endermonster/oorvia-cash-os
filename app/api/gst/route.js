import { supabase } from '@/lib/supabase'

function r2(n) { return Math.round(n * 100) / 100 }

// OTC = order_value × rate / (100 + rate)  [prices are GST-inclusive, standard in Indian D2C]
function calcOTC(price, rate) {
  return r2(price * rate / (100 + rate))
}

// Seller's home state — orders to the same state → CGST + SGST, all others → IGST
const SELLER_STATE      = 'MH'
const SELLER_STATE_FULL = 'MAHARASHTRA'

function isIntraState(customerState) {
  if (!customerState) return false
  const s = customerState.trim().toUpperCase()
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
  // gst_rate is stored on the order (populated from vFulfill import)
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, status, payment_mode, order_value, checkout_fee, cashfree_fee, order_mgmt_fee, platform_fee, cod_fee, shopify_order_id, order_date, customer_state, gst_rate')
    .gte('order_date', start)
    .lte('order_date', end)
    .neq('status', 'cancelled')

  if (ordersErr) return Response.json({ error: ordersErr.message }, { status: 500 })

  // Fetch ad spend for the month
  const { data: adSpend, error: adsErr } = await supabase
    .from('ad_spend')
    .select('spend_date, spend, campaign')
    .gte('spend_date', start)
    .lte('spend_date', end)

  if (adsErr) return Response.json({ error: adsErr.message }, { status: 500 })

  // Fetch manual GST entries for the month
  const { data: manualEntries, error: manualErr } = await supabase
    .from('gst_entries')
    .select('*')
    .eq('entry_month', start)
    .order('created_at', { ascending: false })

  if (manualErr) return Response.json({ error: manualErr.message }, { status: 500 })

  // ── OTC Calculation ────────────────────────────────────────────────────────
  // Only on DELIVERED orders (revenue realised, invoice settled)
  // IGST for inter-state (customer outside MH), CGST+SGST for intra-state (customer in MH)
  const deliveredOrders = (orders || []).filter((o) => o.status === 'delivered')

  const otcOrders = deliveredOrders.map((o) => {
    const rate  = Number(o.gst_rate ?? 18)
    const gst   = calcOTC(Number(o.order_value), rate)
    const intra = isIntraState(o.customer_state)

    return {
      order_id:        o.id,
      shopify_order_id: o.shopify_order_id,
      order_date:      o.order_date,
      customer_state:  o.customer_state || null,
      order_value:     Number(o.order_value),
      gst_rate:        rate,
      taxable_value:   r2(Number(o.order_value) - gst),
      gst_amount:      gst,
      igst:            intra ? 0 : gst,
      cgst:            intra ? r2(gst / 2) : 0,
      sgst:            intra ? r2(gst / 2) : 0,
    }
  })

  const totalOTC    = r2(otcOrders.reduce((s, o) => s + o.gst_amount, 0))
  const totalIGST   = r2(otcOrders.reduce((s, o) => s + o.igst, 0))
  const totalCGST   = r2(otcOrders.reduce((s, o) => s + o.cgst, 0))
  const totalSGST   = r2(otcOrders.reduce((s, o) => s + o.sgst, 0))
  const manualOTC   = r2((manualEntries || []).filter((e) => e.type === 'otc').reduce((s, e) => s + Number(e.gst_amount), 0))

  // ── ITC Calculation ────────────────────────────────────────────────────────
  // 1. vFulfill fulfillment fees — Total Amt is GST-inclusive (18% GST)
  //    ITC = fee × 18/118
  let itcFulfillment = 0
  for (const o of orders || []) {
    const vfFees =
      Number(o.order_mgmt_fee || 0) +
      Number(o.platform_fee   || 0) +
      Number(o.cod_fee        || 0)
    itcFulfillment += vfFees * 18 / 118
  }
  itcFulfillment = r2(itcFulfillment)

  // 2. Shopify checkout fee — stored as 2.36% (2% base + 18% GST), GST-inclusive
  //    ITC = checkout_fee × 18/118
  let itcCheckout = 0
  for (const o of orders || []) {
    itcCheckout += Number(o.checkout_fee || 0) * 18 / 118
  }
  itcCheckout = r2(itcCheckout)

  // 3. Cashfree payment gateway fee — stored as 2.5% base, 18% GST on top
  //    ITC = cashfree_fee × 0.18
  let itcCashfree = 0
  for (const o of orders || []) {
    if (o.payment_mode === 'prepaid') {
      itcCashfree += Number(o.cashfree_fee || 0) * 0.18
    }
  }
  itcCashfree = r2(itcCashfree)

  // 4. Meta Ads ITC: 18% GST on ad spend (IGST, since Meta is a foreign service)
  const itcMetaAds = r2((adSpend || []).reduce((s, e) => s + Number(e.spend || 0), 0) * 0.18)

  // 5. Manual ITC entries (Shopify RCM, vFulfill membership, etc.)
  const itcManual = r2((manualEntries || []).filter((e) => e.type === 'itc').reduce((s, e) => s + Number(e.gst_amount), 0))

  const totalITC      = r2(itcFulfillment + itcCheckout + itcCashfree + itcMetaAds + itcManual)
  const netLiability  = r2(totalOTC + manualOTC - totalITC)

  return Response.json({
    period: { start, end, month },
    otc: {
      from_orders:  totalOTC,
      from_manual:  manualOTC,
      total:        r2(totalOTC + manualOTC),
      igst:         totalIGST,
      cgst:         totalCGST,
      sgst:         totalSGST,
      orders:       otcOrders,
    },
    itc: {
      from_fulfillment: itcFulfillment,
      from_checkout:    itcCheckout,
      from_cashfree:    itcCashfree,
      from_meta_ads:    itcMetaAds,
      from_manual:      itcManual,
      total:            totalITC,
    },
    net_liability:    netLiability,
    manual_entries:   manualEntries || [],
    ad_spend_total:   r2((adSpend || []).reduce((s, e) => s + Number(e.spend || 0), 0)),
    order_count:      deliveredOrders.length,
  })
}
