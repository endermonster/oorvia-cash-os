import { supabase } from '@/lib/supabase'

function r2(n) { return Math.round(n * 100) / 100 }

// OTC = selling_price × rate / (100 + rate)  [prices are GST-inclusive, standard in Indian D2C]
function calcOTC(price, rate) {
  return r2(price * rate / (100 + rate))
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month') // YYYY-MM
  if (!month) return Response.json({ error: 'month param required' }, { status: 400 })

  const [y, m] = month.split('-').map(Number)
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const end = new Date(y, m, 0).toISOString().slice(0, 10)

  // Fetch all non-cancelled orders for the month + their product gst_rate
  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, status, payment_mode, selling_price, checkout_fee, payment_gateway_fee, inbound_fee, delivery_charge, packing_fee, cod_handling_fee, other_3pl_charges, rto_charge, shopify_order_id, order_date, products(name, gst_rate)')
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

  // ── OTC Calculation ────────────────────────────────────────────────
  // Only on DELIVERED orders (revenue realised, invoice settled)
  const deliveredOrders = (orders || []).filter((o) => o.status === 'delivered')
  const otcOrders = deliveredOrders.map((o) => {
    const rate = Number(o.products?.gst_rate ?? 18)
    const gst = calcOTC(Number(o.selling_price), rate)
    return {
      order_id: o.id,
      shopify_order_id: o.shopify_order_id,
      order_date: o.order_date,
      product_name: o.products?.name || '—',
      selling_price: Number(o.selling_price),
      gst_rate: rate,
      taxable_value: r2(Number(o.selling_price) - gst),
      gst_amount: gst,
    }
  })
  const totalOTC = r2(otcOrders.reduce((s, o) => s + o.gst_amount, 0))
  const manualOTC = r2((manualEntries || []).filter((e) => e.type === 'otc').reduce((s, e) => s + Number(e.gst_amount), 0))

  // ── ITC Calculation ────────────────────────────────────────────────
  // 1. 3PL charges: 18% on total 3PL fees (all non-cancelled orders incl. RTO since you paid the charge)
  let itc3PL = 0
  for (const o of orders || []) {
    const total3pl =
      Number(o.inbound_fee || 0) +
      Number(o.delivery_charge || 0) +
      Number(o.packing_fee || 0) +
      Number(o.cod_handling_fee || 0) +
      Number(o.other_3pl_charges || 0) +
      Number(o.rto_charge || 0)
    itc3PL += total3pl * 0.18
  }
  itc3PL = r2(itc3PL)

  // 2. Checkout service ITC: fee is 2.36% (2% base + 18% GST on base)
  //    ITC = checkout_fee × 18/118
  let itcCheckout = 0
  for (const o of orders || []) {
    itcCheckout += Number(o.checkout_fee || 0) * 18 / 118
  }
  itcCheckout = r2(itcCheckout)

  // 3. Payment gateway ITC: stored fee is the base amount (2.5%), 18% GST on top
  let itcPaymentGW = 0
  for (const o of orders || []) {
    if (o.payment_mode === 'prepaid') {
      itcPaymentGW += Number(o.payment_gateway_fee || 0) * 0.18
    }
  }
  itcPaymentGW = r2(itcPaymentGW)

  // 4. Meta Ads ITC: 18% GST on ad spend (IGST)
  const itcMetaAds = r2((adSpend || []).reduce((s, e) => s + Number(e.spend || 0), 0) * 0.18)

  // 5. Manual ITC entries (Shopify RCM, vFulfill membership, etc.)
  const itcManual = r2((manualEntries || []).filter((e) => e.type === 'itc').reduce((s, e) => s + Number(e.gst_amount), 0))

  const totalITC = r2(itc3PL + itcCheckout + itcPaymentGW + itcMetaAds + itcManual)
  const netLiability = r2(totalOTC + manualOTC - totalITC)

  return Response.json({
    period: { start, end, month },
    otc: {
      from_orders: totalOTC,
      from_manual: manualOTC,
      total: r2(totalOTC + manualOTC),
      orders: otcOrders,
    },
    itc: {
      from_3pl: itc3PL,
      from_checkout: itcCheckout,
      from_payment_gw: itcPaymentGW,
      from_meta_ads: itcMetaAds,
      from_manual: itcManual,
      total: totalITC,
    },
    net_liability: netLiability,
    manual_entries: manualEntries || [],
    ad_spend_total: r2((adSpend || []).reduce((s, e) => s + Number(e.spend || 0), 0)),
    order_count: deliveredOrders.length,
  })
}
