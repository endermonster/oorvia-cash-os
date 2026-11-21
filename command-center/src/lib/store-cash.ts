import type { CashPosition, StoreId } from './types'

/**
 * One store's own cash: COD vFulfill owes it and its gateway settlements. The bank account and the vFulfill wallet
 * serve all three stores, so they count in the VXP total only and are never split (the same rule as shared costs,
 * decided 2026-11-20). Pure.
 */
export function storeCash(c: CashPosition, storeId: StoreId) {
  const cod = c.codDueByStore.find((r) => r.storeId === storeId)
  const settlements = c.settlements?.filter((s) => s.storeId === storeId) ?? null
  const settlementsTotal = settlements?.reduce((s, x) => s + x.amount, 0) ?? 0
  const codDue = cod?.amount ?? 0
  return {
    codDue,
    codDueOrders: cod?.orders ?? 0,
    settlements,
    settlementsTotal,
    total: codDue + settlementsTotal,
    /** Shown for reference only: these belong to All VXP. */
    shared: { bank: c.bank, vfulfillWallet: c.vfulfillWallet },
  }
}

export type StoreCash = ReturnType<typeof storeCash>
