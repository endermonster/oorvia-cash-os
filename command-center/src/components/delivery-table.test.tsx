import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DeliveryRow } from '@/lib/metrics'
import { DeliveryTable } from './StoreView'

const z = { delivered: 0, rto: 0 }
const cells = (all: typeof z, cod: typeof z, prepaid: typeof z): DeliveryRow['cells'] =>
  ({ '7d': { all: z, cod: z, prepaid: z }, '30d': { all, cod, prepaid: z }, lifetime: { all, cod, prepaid } })

describe('DeliveryTable', () => {
  it('shows each window with its count, and a dash where nothing closed', () => {
    const html = renderToStaticMarkup(<DeliveryTable rows={[
      { sku: 'YB31', name: 'Yubi Ring', cells: cells({ delivered: 468, rto: 90 }, { delivered: 291, rto: 89 }, { delivered: 177, rto: 1 }) },
      { sku: null, name: 'All Oorvia', cells: cells({ delivered: 468, rto: 90 }, { delivered: 291, rto: 89 }, { delivered: 177, rto: 1 }) },
    ]} />)
    expect(html).toContain('7 days')
    expect(html).toContain('All time')
    expect(html).toContain('83.9%')
    expect(html).toContain('558 closed')
    expect(html).toContain('COD 76.6% · Prepaid 99.4%')
    expect(html).toContain('COD 76.6% · Prepaid —') // 30 days: no prepaid closed
    expect(html).toContain('All Oorvia')
    expect(html).toContain('—')
  })
  it('says so when nothing has closed', () => {
    expect(renderToStaticMarkup(<DeliveryTable rows={[]} />)).toContain('No shipments closed yet.')
  })
})
