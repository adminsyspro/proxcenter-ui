import { describe, expect, it } from 'vitest'

import { MAX_HISTORY_LIMIT, parseHistoryLimit } from './historyLimit'

describe('parseHistoryLimit', () => {
  it('returns undefined for null', () => {
    expect(parseHistoryLimit(null)).toBeUndefined()
  })

  it('returns undefined for an empty string', () => {
    expect(parseHistoryLimit('')).toBeUndefined()
  })

  it('returns undefined for nonnumeric input', () => {
    expect(parseHistoryLimit('abc')).toBeUndefined()
  })

  it('returns undefined for zero and negative values', () => {
    expect(parseHistoryLimit('0')).toBeUndefined()
    expect(parseHistoryLimit('-5')).toBeUndefined()
  })

  it('returns a valid limit', () => {
    expect(parseHistoryLimit('200')).toBe(200)
  })

  it('caps a large limit at MAX_HISTORY_LIMIT', () => {
    expect(parseHistoryLimit('999999')).toBe(MAX_HISTORY_LIMIT)
  })

  it('parses a decimal string as an integer', () => {
    expect(parseHistoryLimit('12.9')).toBe(12)
  })
})
