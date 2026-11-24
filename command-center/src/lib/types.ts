/**
 * The data contract the Command Center screen reads. The mock module fills it
 * today; the Supabase backend fills it later. Every field notes its future source.
 */

export type StoreId = 'oorvia' | 'kaiven' | 'selnova'

export type Store = {
  id: StoreId
  name: string
  liveSince: string
  gateways: string[]
  /** Blended gateway fee on prepaid orders, ex-GST. Source: the store's gateway settlement reports. */
  gatewayPct: number
}

/** One sellable SKU. A store has one or more. Source: Shopify products + `cogs_history`. */
export type Product = {
  sku: string
  storeId: StoreId
  name: string
  /** COD list price, incl. GST. Prepaid pays this minus the prepaid discount. */
  price: number
  /** Ex-GST, today's cost. Null when no cost is on record: breakeven is then not computed, never defaulted to 0. Used for breakeven (forward-looking) only; past orders carry their own cost in `OrderDay.cogs`. */
  cogs: number | null
  packedWeightGrams: number
  liveSince: string
  /** Shopify product handle. A Meta campaign maps to this SKU when its ads land on `/products/{handle}`. */
  handle: string
  /** Set by hand: Testing while ads test it, Live once stock lands in India. Labels only; no math reads it. */
  stage: ProductStage
}

export type ProductStage = 'testing' | 'live' | 'out_of_stock' | 'failed'

export type PaymentType = 'cod' | 'prepaid'

/**
 * An order's payment as recorded. `unknown` only for history Shopify cannot settle (no gateway, no
 * COD charge from vFulfill); never guessed. Delivery rates and COD share use known payments only.
 */
export type OrderPayment = PaymentType | 'unknown'

/**
 * Shipments that closed (delivered or RTO) on one day, per SKU × payment type.
 * Counted by close date, so any window (7 days, 30 days, lifetime) is a sum of
 * days. Source: vFulfill shipments export (`Closed On`, `Shipment Status`)
 * joined to Shopify orders, which carry the payment type from the moment they
 * are placed.
 */
export type ResolvedDay = { closedOn: string; storeId: StoreId; sku: string; payment: OrderPayment; delivered: number; rto: number }

/**
 * Shopify orders placed on one day, for one store × SKU × payment type. An order belongs to the SKU of its
 * highest-value line item, but its costs cover **every** line item, so a 2-unit or mixed order is costed whole.
 * A product is identified by (storeId, sku): two stores may use the same SKU.
 */
export type OrderDay = {
  date: string // YYYY-MM-DD, IST
  storeId: StoreId
  sku: string
  payment: OrderPayment
  orders: number
  /** Units across all line items. */
  units: number
  /** Booked, incl. GST (`current_total_price`). */
  revenue: number
  /** Ex-GST, all line items, each at the cost effective on the order date (`cogs_history`). */
  cogs: number
  /** Σ over orders of ceil(whole order's packed grams / 500), and / 1000: vFulfill's shipping and storage slabs. */
  slabs500: number
  slabsKg: number
  /** Orders with a line item that had no cost on record. Their COGS is understated. Absent on hourly rows. */
  ordersMissingCogs?: number
}

/**
 * One Meta campaign, one day. Spend/impressions/clicks/purchases: Meta Insights. `attributedOrders`: Shopify orders
 * whose `landing_page_url` (written by the Fastrr checkout) carries this `campaign_id`. Orders without one stay
 * unattributed: they count for their SKU, never for a campaign.
 */
export type CampaignDay = {
  date: string
  storeId: StoreId
  campaignId: string
  /** The SKU the campaign's ads land on. Null only if that handle matches no product (handle changed, not synced). */
  sku: string | null
  spend: number
  impressions: number
  clicks: number
  metaPurchases: number
  attributedOrders: number
}

/** The same rows for the hours of today. */
export type OrderHour = Omit<OrderDay, 'date'> & { hour: number }
export type CampaignHour = Omit<CampaignDay, 'date'> & { hour: number }

export type Campaign = {
  id: string
  storeId: StoreId
  /** From the ads' landing URL (`/products/{handle}`). One campaign sells one SKU. Null only if the handle matches no product. */
  sku: string | null
  name: string
  /** Meta `effective_status` as last synced (ACTIVE, PAUSED, CAMPAIGN_PAUSED, ADSET_PAUSED, WITH_ISSUES, DISAPPROVED, …). Null when never listed. */
  status: string | null
}

/** Source: Shopify webhooks. */
export type RecentOrder = {
  id: string
  storeId: StoreId
  placedAt: string // ISO
  sku: string
  product: string
  value: number
  payment: OrderPayment
  city: string
}

export type CashPosition = {
  asOf: string
  /** Typed in by hand on /settings (or scripts/bank-balance.ts); null until first entered. */
  bank: { amount: number; enteredAt: string } | null
  /**
   * Gateway money captured, not yet settled, net of fee + GST: an **estimate** from Shopify prepaid orders and T+2
   * (src/lib/settlements.ts), no gateway API. Null when not read; an empty list when nothing is pending.
   */
  settlements: { gateway: string; storeId: StoreId; amount: number; orders: number }[] | null
  /** vFulfill transactions import: credits − debits. */
  vfulfillWallet: number
  /** Date of the newest vFulfill transaction (YYYY-MM-DD); null if none imported. */
  vfulfillAsOf: string | null
  /** COD orders vFulfill delivered but has not remitted yet (shipments + transactions imports). */
  codDue: number
  codDueOrders: number
  /** The same COD due, per store (`codDue` is their sum). */
  codDueByStore: { storeId: StoreId; amount: number; orders: number }[]
}

/** The GST figure Money's GST card leads with: the oldest month not marked filed (src/lib/gst.ts GstResult.months[0]). */
export type GstPosition = {
  month: string
  /** ₹, cash to pay with that month's GSTR-3B (GstMonth.cash: payable after credit + RCM). */
  cash: number
  dueDate: string // GSTR-3B
  /** The month is still running: figures so far. */
  partial: boolean
}

export type SyncStatus = {
  /** Age of the oldest connected store's latest successful run. Null = no store has ever synced. */
  metaMinutesAgo: number | null
  /** Each Meta store's own latest successful run, minutes ago. A store missing here has never synced. */
  metaMinutesAgoByStore: Partial<Record<StoreId, number>>
  /** Per Meta store: its latest successful sync covered yesterday and matched campaign spend to the account total. */
  metaYesterdayVerified: Partial<Record<StoreId, boolean>>
  /** Stores expected to have Meta that have never had a successful sync (no access granted yet). */
  metaNotConnected: StoreId[]
  shopifyMinutesAgo: number | null
  /** Days since the last successful shipments import ran. Says nothing about what the file contained. */
  vfulfillImportDaysAgo: number | null
  /** Newest `closed_on` in cc_shipments (YYYY-MM-DD, IST): the shipments data runs to this day. Null = no closed shipment on record. */
  shipmentsThrough: string | null
  /**
   * Whole days from `shipmentsThrough` to today (IST), or from a missing store's last import when that is older.
   * Staleness of the shipments data itself: an import that added nothing, or left a store out, leaves it growing.
   */
  vfulfillDataDaysAgo: number | null
  /**
   * Stores left out of the newest shipments import (unticked in vFulfill's export) though they have orders that should
   * be in it. Only stores with vFulfill history; one with no shipment rows yet is never listed.
   */
  vfulfillMissingStores: StoreId[]
  /**
   * Orders vFulfill should have shipped by now that the shipments data does not show: from stores with vFulfill history,
   * real and uncancelled, placed after `shipmentsThrough` and more than SHIP_LAG_DAYS ago, with no shipment row.
   * 0 = the data is current even when `shipmentsThrough` is old (nothing new to ship). Null = not checked.
   */
  vfulfillOverdueOrders: number | null
  /**
   * Shipments still open (in transit, NDR) in the last export, for orders placed in the last OPEN_WINDOW_DAYS (60) at
   * stores with vFulfill history: each may have closed since, so the data counts as current only when this and
   * `vfulfillOverdueOrders` are both 0. Older open rows are stuck in vFulfill, not moving, and are left out.
   * Null = not checked.
   */
  vfulfillOpenShipments: number | null
}
