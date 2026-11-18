import { describe, expect, it } from 'vitest'
import { dbError, isRetryableDb } from './db-error'

describe('isRetryableDb', () => {
  it.each([
    ['statement timeout', '57014', 500],
    ['too many connections', '53300', 500],
    ['connection failure', '08006', 500],
    ['server shutting down', '57P01', 503],
    ['deadlock', '40P01', 500],
    ['PostgREST pool timeout', 'PGRST003', 504],
    ['PostgREST cannot connect', 'PGRST001', 503],
  ])('retries %s', (_, code, status) => {
    expect(isRetryableDb(code, status)).toBe(true)
  })

  it.each([[503], [502], [504], [429], [0]])('retries HTTP %i with no code', (status) => {
    expect(isRetryableDb(undefined, status)).toBe(true)
  })

  it('retries a network failure with no code or status', () => {
    expect(isRetryableDb(undefined, undefined, 'TypeError: fetch failed')).toBe(true)
  })

  it.each([
    ['not-null violation', '23502', 400],
    ['unique violation', '23505', 409],
    ['raised exception', 'P0001', 400],
    ['function not found', 'PGRST202', 404],
  ])('does not retry %s', (_, code, status) => {
    expect(isRetryableDb(code, status)).toBe(false)
  })
})

describe('dbError', () => {
  it('keeps the code and status and labels the message', () => {
    const e = dbError('cc_upsert_order #KAI1', { message: 'canceling statement due to statement timeout', code: '57014' }, 500)
    expect(e.message).toBe('cc_upsert_order #KAI1: canceling statement due to statement timeout')
    expect(e.code).toBe('57014')
    expect(e.status).toBe(500)
    expect(e.transient).toBe(true)
  })

  it('treats an empty code as none', () => {
    expect(dbError('x', { message: 'bad', code: '' }, 400).code).toBeUndefined()
  })
})
