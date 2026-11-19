/**
 * Port of the "Oorvia Pricing Master" Google Sheet (Calculator rows 39–51,
 * Assumptions tab). Every number is per ORDER PLACED, in ₹.
 *
 * Breakeven CPA   = profit before ads per order placed (sheet row 51).
 * Breakeven ROAS  = average price paid (incl. GST) ÷ breakeven CPA — the scale
 *                   Meta reports on, because Shopify sends GST-inclusive values.
 * Target ROAS     = Vedaant's rule: ex-GST breakeven + 1.5, then put back on
 *                   Meta's scale (× 1.18) so it compares with Ads Manager.
 */

export type Assumptions = {
  gstRate: number
  prepaidFlat: number
  prepaidPct: number
  stockLostOnRto: number
  returnShipMult: number
  inwardFee: number
  storageRatePerDayPerKg: number
  storageDays: number
  outboundFee: number
  printFee: number
  packBase: number
  packExtraPer500g: number
  shipPer500g: number
  rtoHandling: number
  confirmationFee: number
  confirmationShare: number
  whatsappFee: number
  whatsappShare: number
  codPct: number
  codMin: number
  convPct: number
  convMin: number
  checkoutPct: number
  checkoutOnCod: boolean
  gatewayPct: number
  gatewayOnCod: boolean
  overheadPct: number
  /** 1 when GST on VF charges and gateway fees is claimed back as ITC. */
  vfMult: number
}

/** Values from the sheet's Assumptions tab (2026-11-18). */
export const SHEET_ASSUMPTIONS: Assumptions = {
  gstRate: 0.18,
  prepaidFlat: 100,
  prepaidPct: 0,
  stockLostOnRto: 0.1,
  returnShipMult: 1,
  inwardFee: 5,
  storageRatePerDayPerKg: 0.12,
  storageDays: 30,
  outboundFee: 8,
  printFee: 2,
  packBase: 8,
  packExtraPer500g: 3,
  shipPer500g: 58,
  rtoHandling: 5,
  confirmationFee: 25,
  confirmationShare: 1,
  whatsappFee: 5,
  whatsappShare: 0,
  codPct: 0.017,
  codMin: 36,
  convPct: 0.04,
  convMin: 40,
  checkoutPct: 0.02,
  checkoutOnCod: true,
  gatewayPct: 0.02,
  gatewayOnCod: false,
  overheadPct: 0,
  vfMult: 1,
}

export type ProductEconomics = {
  /** Listed (COD) price, incl. GST. */
  price: number
  /** Cost of goods per order, ex-GST (one unit for a breakeven; every line item for real orders). */
  cogs: number
  packedWeightGrams: number
  deliveryRate: number
  codShare: number
  /**
   * Shipping slabs per order, when known from real orders (averages are fine: every
   * slab-based charge is linear). Otherwise derived from `packedWeightGrams`.
   */
  slabs500?: number
  slabsKg?: number
}

export type Breakeven = {
  avgPricePaid: number
  breakevenCpa: number
  /** On Meta's scale (incl. GST). */
  breakevenRoas: number
  breakevenRoasExGst: number
  /** Breakeven ex-GST + 1.5, put back on Meta's scale. */
  targetRoas: number
  targetRoasExGst: number
}

export const TARGET_BUFFER_EX_GST = 1.5

export function breakeven(p: ProductEconomics, a: Assumptions = SHEET_ASSUMPTIONS): Breakeven {
  const d = p.deliveryRate
  const cod = p.codShare
  const prepaidOff = a.prepaidFlat + a.prepaidPct * p.price
  const avgPricePaid = p.price - (1 - cod) * prepaidOff
  const prepaidPrice = p.price - prepaidOff

  const slabs500 = p.slabs500 ?? Math.max(1, Math.ceil(p.packedWeightGrams / 500))
  const slabsKg = p.slabsKg ?? Math.max(1, Math.ceil(p.packedWeightGrams / 1000))
  const m = a.vfMult

  const inward = a.inwardFee * m
  const storage = a.storageRatePerDayPerKg * a.storageDays * slabsKg * m
  const outbound = a.outboundFee * m
  const print = a.printFee * m
  const pack = (a.packBase + a.packExtraPer500g * (slabs500 - 1)) * m
  const ship = a.shipPer500g * slabs500 * m
  const confirm = (a.confirmationShare * a.confirmationFee + a.whatsappShare * a.whatsappFee) * m
  const returnShip = ship * a.returnShipMult
  const rtoHandling = a.rtoHandling * m

  const revenue = d * avgPricePaid
  const gst = -d * avgPricePaid * a.gstRate / (1 + a.gstRate)
  const cogs = -d * p.cogs
  const vfDelivered = -d * (inward + storage)
  const codFee = -d * cod * Math.max(a.codMin * m, a.codPct * m * p.price)
  const convFee = -d * Math.max(a.convMin * m, a.convPct * m * avgPricePaid)
  const checkout = -d * a.checkoutPct * m * ((1 - cod) * prepaidPrice + cod * p.price * (a.checkoutOnCod ? 1 : 0))
  const gateway = -d * a.gatewayPct * m * ((1 - cod) * prepaidPrice + cod * p.price * (a.gatewayOnCod ? 1 : 0))
  const overheads = -d * a.overheadPct * avgPricePaid / (1 + a.gstRate)
  const vfAllOrders = -(outbound + print + pack + ship + confirm)
  const rtoLoss = -(1 - d) * (returnShip + rtoHandling + a.stockLostOnRto * p.cogs)

  const breakevenCpa =
    revenue + gst + cogs + vfDelivered + codFee + convFee + checkout + gateway + overheads + vfAllOrders + rtoLoss

  return fromCpa(avgPricePaid, breakevenCpa, a)
}

/**
 * Breakeven ROAS and target from a price paid and a profit-before-ads per order. A product that loses money
 * before any ad (`breakevenCpa` ≤ 0) breaks even at no ROAS: both come out as Infinity, so every ROAS is "below".
 */
export function fromCpa(avgPricePaid: number, breakevenCpa: number, a: Assumptions = SHEET_ASSUMPTIONS): Breakeven {
  const breakevenRoas = breakevenCpa > 0 ? avgPricePaid / breakevenCpa : Infinity
  const breakevenRoasExGst = breakevenRoas / (1 + a.gstRate)
  const targetRoasExGst = breakevenRoasExGst + TARGET_BUFFER_EX_GST
  const targetRoas = targetRoasExGst * (1 + a.gstRate)
  return { avgPricePaid, breakevenCpa, breakevenRoas, breakevenRoasExGst, targetRoas, targetRoasExGst }
}

/**
 * Breakeven for a COD/prepaid mix where each payment type has its own delivery
 * rate. Computes an all-COD order and an all-prepaid order, then weights them.
 */
export function blendedBreakeven(
  p: Omit<ProductEconomics, 'deliveryRate' | 'codShare'>,
  codShare: number,
  rates: { cod: number; prepaid: number },
  a: Assumptions = SHEET_ASSUMPTIONS,
): Breakeven {
  const cod = breakeven({ ...p, deliveryRate: rates.cod, codShare: 1 }, a)
  const pre = breakeven({ ...p, deliveryRate: rates.prepaid, codShare: 0 }, a)
  return fromCpa(
    codShare * cod.avgPricePaid + (1 - codShare) * pre.avgPricePaid,
    codShare * cod.breakevenCpa + (1 - codShare) * pre.breakevenCpa,
    a,
  )
}

/** False when the product loses money before ads, so no ROAS can break even. */
export const breaksEven = (b: Pick<Breakeven, 'breakevenRoas'>) => Number.isFinite(b.breakevenRoas)

/** "No ROAS breaks even: loses ₹X per order before ads", for screens that would show a breakeven. */
export const noBreakevenText = (b: Pick<Breakeven, 'breakevenCpa'>) =>
  `No ROAS breaks even: loses ₹${Math.max(0, Math.round(-b.breakevenCpa)).toLocaleString('en-IN')} per order before ads`

export type RoasZone = 'below' | 'covering' | 'profit'

export function roasZone(roas: number, b: Pick<Breakeven, 'breakevenRoas' | 'targetRoas'>): RoasZone {
  if (roas < b.breakevenRoas) return 'below'
  if (roas < b.targetRoas) return 'covering'
  return 'profit'
}
