import { describe, expect, it } from 'vitest'
import { accountsOf, AD_ACCOUNTS, metaStoreIds } from './accounts'

describe('ad account allowlist', () => {
  it('is exactly these 4 accounts', () => {
    expect(AD_ACCOUNTS.map((a) => `${a.storeId}:${a.id}`)).toEqual([
      'kaiven:1874064503928537', 'oorvia:1338726490985485', 'oorvia:1447663743539549', 'selnova:959242917044218',
    ])
  })

  it('gives Oorvia both its accounts and the other stores one each', () => {
    expect(accountsOf('oorvia')).toHaveLength(2)
    expect(accountsOf('kaiven')).toHaveLength(1)
    expect(accountsOf('nobody')).toEqual([])
  })

  it('reads each portfolio token from its own variable; both Oorvia accounts share the original one', () => {
    expect(Object.fromEntries(AD_ACCOUNTS.map((a) => [a.name, a.tokenEnv]))).toEqual({
      Kaiven: 'META_ACCESS_TOKEN_KAIVEN', 'Oorvia-1': 'META_ACCESS_TOKEN', 'Oorvia-2': 'META_ACCESS_TOKEN', Selnova1: 'META_ACCESS_TOKEN_SELNOVA',
    })
  })

  it('lists each store with an account once', () => {
    expect(metaStoreIds()).toEqual(['kaiven', 'oorvia', 'selnova'])
  })
})
