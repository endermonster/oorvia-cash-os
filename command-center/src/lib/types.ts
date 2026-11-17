/**
 * The data contract the Command Center screen reads. The mock module fills it
 * today; the Supabase backend fills it later. Every field notes its future source.
 */

export type StoreId = 'oorvia' | 'kaiven' | 'selnova'

export type Store = {
  id: StoreId
  name: string
  /** Live date of the store's current product. */
  liveSince: string
  product: { name: string; price: number; cogs: number; packedWeightGrams: number }
  /** Delivered ÷ (delivered + RTO). Source: vFulfill shipments import. */
  deliveryRate: { value: number; assumedFrom: StoreId | null }
  /** Source: Shopify orders. */
  codShare: { value: number; assumedFrom: StoreId | null }
  gateways: string[]
}

/** One store, one day. Spend/impressions/clicks/purchases: Meta. Orders/revenue: Shopify. */
export type DailyRow = {
  date: string // YYYY-MM-DD, IST
  storeId: StoreId
  spend: number
  impressions: number
  clicks: number
  metaPurchases: number
  orders: number
  codOrders: number
  revenue: number // booked, incl. GST
}

/** Same shape as DailyRow, for the hours of today. */
export type HourlyRow = Omit<DailyRow, 'date'> & { hour: number }

export type Campaign = {
  id: string
  storeId: StoreId
  name: string
  /** Mock only: share of the store's spend, and how its CPA compares with the store's. */
  spendShare: number
  cpaFactor: number
}

/** Source: Shopify webhooks. */
export type RecentOrder = {
  id: string
  storeId: StoreId
  placedAt: string // ISO
  product: string
  value: number
  payment: 'cod' | 'prepaid'
  city: string
}

export type CashPosition = {
  asOf: string
  bank: { amount: number; enteredAt: string } // typed in by hand
  settlements: { gateway: string; storeId: StoreId; amount: number }[] // Razorpay / PayU / Cashfree APIs
  vfulfillWallet: number // vFulfill import
  codDue: number // vFulfill import
}

export type GstPosition = {
  month: string
  outputTax: number
  inputCredit: number
  dueDate: string // GSTR-3B
}

export type SyncStatus = {
  metaMinutesAgo: number
  shopifyMinutesAgo: number
  vfulfillImportDaysAgo: number
}
