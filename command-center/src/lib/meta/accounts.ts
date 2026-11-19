/**
 * The ONLY Meta ad accounts this app may ever call. A constant, not a database row, so it can change only
 * through a reviewed commit. Nothing may list the accounts a token can see or iterate beyond this list.
 */
export type AdAccount = {
  storeId: string; id: string; name: string
  /** The environment variable holding the system user token for this account. Each business portfolio has its own. */
  tokenEnv: string
}

export const AD_ACCOUNTS: readonly AdAccount[] = [
  { storeId: 'kaiven', id: '1874064503928537', name: 'Kaiven', tokenEnv: 'META_ACCESS_TOKEN_KAIVEN' },
  { storeId: 'oorvia', id: '1338726490985485', name: 'Oorvia-1', tokenEnv: 'META_ACCESS_TOKEN' }, // live
  { storeId: 'oorvia', id: '1447663743539549', name: 'Oorvia-2', tokenEnv: 'META_ACCESS_TOKEN' }, // backup
  { storeId: 'selnova', id: '959242917044218', name: 'Selnova1', tokenEnv: 'META_ACCESS_TOKEN_SELNOVA' },
]

export const accountsOf = (storeId: string): AdAccount[] => AD_ACCOUNTS.filter((a) => a.storeId === storeId)

/** Stores that have an allowlisted ad account: the ones a Meta sync is expected for. */
export const metaStoreIds = (): string[] => [...new Set(AD_ACCOUNTS.map((a) => a.storeId))]
