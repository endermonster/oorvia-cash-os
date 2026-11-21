import { describe, expect, it } from 'vitest'
import { cityKey, cityOnMap } from './cities'

describe('cityKey', () => {
  it('normalises the messy names Shopify stores', () => {
    expect(cityKey('Mapusa, North Goa.')).toContain('mapusa')
    expect(cityKey('K.V.Rangareddy')).toContain('k v rangareddy')
    expect(cityKey('Bijapur(KAR)')).toContain('bijapur')
    expect(cityKey('Karnal Haryana')).toContain('karnal')
    expect(cityKey('Dadra & Nagar Haveli')).toContain('dadra nagar haveli')
    expect(cityKey('  Pune  ')).toEqual(['pune'])
  })
})

describe('cityOnMap', () => {
  it('places districts that Shopify gives instead of a town', () => {
    for (const c of ['South West Delhi', 'Imphal West', 'East Khasi Hills', 'Bengaluru Urban', 'Medchal Malkajgiri', 'Gautam Buddha Nagar', 'Kamrup Metro', 'South 24 Parganas']) {
      expect(cityOnMap(c), c).not.toBeNull()
    }
  })

  it('puts a Delhi district on Delhi', () => {
    expect(cityOnMap('West Delhi')).toEqual(cityOnMap('Delhi'))
  })

  it('leaves non-places without a dot', () => {
    expect(cityOnMap('Session Court')).toBeNull()
    expect(cityOnMap('—')).toBeNull()
  })
})
