import { describe, expect, it } from 'vitest'
import { href, type ViewState } from './nav'

describe('href', () => {
  const view: ViewState = { store: 'all', period: '7d', keep: { path: '/orders', params: { month: '2026-08', status: 'rto' } } }

  it("a link back to the same page keeps that page's own query, with the new store", () => {
    expect(href('/orders', { ...view, store: 'kaiven' })).toBe('/orders?store=kaiven&month=2026-08&status=rto')
  })

  it('links to other pages drop it', () => {
    expect(href('/money', { ...view, store: 'kaiven' })).toBe('/money?store=kaiven')
    expect(href('/', view)).toBe('/')
  })

  it('without keep, unchanged', () => {
    expect(href('/orders', { store: 'oorvia', period: '30d' })).toBe('/orders?store=oorvia&period=30d')
  })
})
