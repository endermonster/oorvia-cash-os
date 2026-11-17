import { describe, expect, it } from 'vitest'
import { breakeven, roasZone } from './calculator'

// Expected values are the cached results of the "Oorvia Pricing Master" sheet
// (Calculator tab, 2026-11-18): 90% delivery, 70% COD, 500 g, sheet defaults.
describe('breakeven (Pricing Master port)', () => {
  it('matches the sheet for Microinfusion System at ₹2,299', () => {
    const b = breakeven({ price: 2299, cogs: 581, packedWeightGrams: 500, deliveryRate: 0.9, codShare: 0.7 })
    expect(b.avgPricePaid).toBe(2269)
    expect(b.breakevenCpa).toBeCloseTo(927.820330338983, 6)
    expect(b.breakevenRoas).toBeCloseTo(2.44551657880897, 6)
    expect(b.breakevenRoasExGst).toBeCloseTo(2.07247167695676, 6)
  })

  it('matches the sheet for DermFirm at ₹1,299', () => {
    const b = breakeven({ price: 1299, cogs: 221, packedWeightGrams: 500, deliveryRate: 0.9, codShare: 0.7 })
    expect(b.avgPricePaid).toBe(1269)
    expect(b.breakevenCpa).toBeCloseTo(554.050755932204, 6)
    expect(b.breakevenRoas).toBeCloseTo(2.29040387800731, 6)
  })

  it('sets target = ex-GST breakeven + 1.5, back on Meta scale', () => {
    const b = breakeven({ price: 1299, cogs: 221, packedWeightGrams: 500, deliveryRate: 0.9, codShare: 0.7 })
    expect(b.targetRoasExGst).toBeCloseTo(1.94102023559941 + 1.5, 6)
    expect(b.targetRoas).toBeCloseTo((1.94102023559941 + 1.5) * 1.18, 6)
  })

  it('classifies ROAS into three zones', () => {
    const z = { breakevenRoas: 2.15, targetRoas: 3.92 }
    expect(roasZone(1.99, z)).toBe('below')
    expect(roasZone(3.11, z)).toBe('covering')
    expect(roasZone(4.2, z)).toBe('profit')
  })
})
