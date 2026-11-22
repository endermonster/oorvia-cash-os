import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./actions', () => {
  const a = async () => null
  return { addCapital: a, addFixedCost: a, addGstEntry: a, deleteCapital: a, deleteCogs: a, deleteFixedCost: a, deleteGstCredit: a, deleteGstEntry: a, endFixedCost: a, importVf: a, saveBank: a, saveCogs: a, saveGstCredit: a, saveRepaid: a, saveStage: a }
})
vi.mock('@/components/TopBar', () => ({ TopBar: () => null }))
vi.mock('@/lib/data', async () => {
  const { MOCK } = await import('@/lib/mock')
  return { getChrome: async () => ({ ...MOCK, source: 'supabase' }) }
})
vi.mock('@/lib/settings-load', () => ({
  loadSettings: async () => ({
    products: [],
    fixedCosts: [
      { id: 1, storeId: null, name: 'Shopify plan', amountPaise: 199400, frequency: 'monthly', startDate: '2026-01-05', endDate: null, gstInclusive: false, rcm: false, note: null },
      { id: 2, storeId: 'oorvia', name: 'Domain', amountPaise: 90000, frequency: 'one-time', startDate: '2026-02-01', endDate: null, gstInclusive: true, rcm: false, note: null },
    ],
    bank: [],
    vfRuns: { shipments: null, transactions: null },
    gst: {
      seeds: [],
      entries: [{ id: 1, month: '2026-10', kind: 'itc', source: 'Amazon Business', description: null, note: null, taxablePaise: 100000, rate: 18, gstPaise: 18000 }],
    },
    capital: [
      { id: 1, kind: 'loan', name: 'Lender', amountPaise: 10000000, receivedOn: '2026-03-01', interestRate: 0.18, dueOn: '2027-03-01', repaidPaise: 0, note: null },
      { id: 2, kind: 'partner', name: 'Partner', amountPaise: 5000000, receivedOn: '2026-01-01', interestRate: null, dueOn: null, repaidPaise: 0, note: null },
    ],
  }),
}))

import Page from './page'

describe('Settings stacked tables', () => {
  it('labels every cell with its own column header', async () => {
    const Settings = (Page({ searchParams: Promise.resolve({}) } as never) as { props: { children: { type: (p: unknown) => Promise<React.ReactNode> } } }).props.children.type
    const html = renderToStaticMarkup(await Settings({ searchParams: Promise.resolve({}) }))
    const tables = html.match(/<table[\s\S]*?<\/table>/g) ?? []
    expect(tables).toHaveLength(3)
    const text = (h: string) => h.replace(/<[^>]*>/g, '')
    for (const t of tables) {
      const heads = [...(t.match(/<thead[\s\S]*?<\/thead>/)?.[0] ?? '').matchAll(/<th(?=[\s>])[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1]))
      const rows = [...(t.match(/<tbody[\s\S]*?<\/tbody>/)?.[0] ?? '').matchAll(/<tr(?=[\s>])[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1])
      expect(rows.length).toBeGreaterThan(0)
      for (const r of rows) {
        // Top-level cells only: cut nested forms and details out first.
        const flat = r.replace(/<details[\s\S]*?<\/details>/g, '').replace(/<form[\s\S]*?<\/form>/g, '')
        const cells = [...flat.matchAll(/<(td|th)(?=[\s>])([^>]*)>/g)]
        expect(cells).toHaveLength(heads.length)
        cells.forEach((c, i) => {
          const label = /data-label="([^"]*)"/.exec(c[2])?.[1]
          // The row header and the empty-headed actions column are unlabelled by design.
          if (label !== undefined) expect(label.replace(/&amp;/g, '&')).toBe(heads[i])
          else expect(c[1] === 'th' || heads[i] === '').toBe(true)
        })
      }
    }
  })
})
