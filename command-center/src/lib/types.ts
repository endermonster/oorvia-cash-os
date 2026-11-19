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
  /** Typed in by hand (scripts/bank-balance.ts); null until first entered. */
  bank: { amount: number; enteredAt: string } | null
  /** Razorpay / PayU / Cashfree APIs; null until they are connected. */
  settlements: { gateway: string; storeId: StoreId; amount: number }[] | null
  /** vFulfill transactions import: credits − debits. */
  vfulfillWallet: number
  /** Date of the newest vFulfill transaction (YYYY-MM-DD); null if none imported. */
  vfulfillAsOf: string | null
  /** COD orders vFulfill delivered but has not remitted yet (shipments + transactions imports). */
  codDue: number
  codDueOrders: number
}

export type GstPosition = {
  month: string
  outputTax: number
  inputCredit: number
  dueDate: string // GSTR-3B
}

export type SyncStatus = {
  /** Age of the oldest connected store's latest successful run. Null = no store has ever synced. */
  metaMinutesAgo: number | null
  /** Stores expected to have Meta that have never had a successful sync (no access granted yet). */
  metaNotConnected: StoreId[]
  shopifyMinutesAgo: number | null
  vfulfillImportDaysAgo: number | null
}
