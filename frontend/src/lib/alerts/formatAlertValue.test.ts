import { describe, expect, it } from 'vitest'

import { formatAlertValue } from '@/lib/alerts/formatAlertValue'

// Discussion #875: a stale-snapshot alert showed "8.789080648219757days" in the
// mail and "8.789080648219757%" in the dashboard dialogs.
describe('formatAlertValue', () => {
  it('rounds to one decimal and spaces a word unit', () => {
    expect(formatAlertValue(8.789080648219757, 'days')).toBe('8.8 days')
    expect(formatAlertValue(12.34, 'min')).toBe('12.3 min')
    expect(formatAlertValue(147, 'ms')).toBe('147 ms')
  })

  it('drops a trailing .0 so a threshold reads as an integer', () => {
    expect(formatAlertValue(7, 'days')).toBe('7 days')
    expect(formatAlertValue(90.0, '%')).toBe('90%')
  })

  it('glues a percentage to its number', () => {
    expect(formatAlertValue(85.25, '%')).toBe('85.3%')
  })

  it('prints the bare number when the alert has no unit', () => {
    expect(formatAlertValue(3)).toBe('3')
    expect(formatAlertValue(3, null)).toBe('3')
    expect(formatAlertValue(3, '')).toBe('3')
  })

  it('returns null when there is nothing to show', () => {
    expect(formatAlertValue(undefined, '%')).toBeNull()
    expect(formatAlertValue(null, '%')).toBeNull()
    expect(formatAlertValue(Number.NaN, '%')).toBeNull()
    expect(formatAlertValue('12', '%')).toBeNull()
  })
})
