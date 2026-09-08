import { describe, expect, it } from 'vitest'

import { formatLatency, formatLatencyAxis } from './latency'

describe('formatLatency', () => {
  it.each([
    [0.84, '0.8 ms'],
    [0, '0.0 ms'],
    [1, '1 ms'],
    [12.4, '12 ms'],
    [12.6, '13 ms'],
    [123456.7, '123457 ms'],
  ])('formats %s milliseconds as %s', (value, expected) => {
    expect(formatLatency(value)).toBe(expected)
  })

  it.each([-1, NaN, Infinity, -Infinity])('shows a placeholder for %s', value => {
    expect(formatLatency(value)).toBe('—')
  })
})

describe('formatLatencyAxis', () => {
  it('keeps two decimals under a millisecond so neighbouring ticks stay distinct', () => {
    expect(formatLatencyAxis(0.05)).toBe('0.05 ms')
    expect(formatLatencyAxis(0.1)).toBe('0.1 ms')
    expect(formatLatencyAxis(0.15)).toBe('0.15 ms')
    expect(formatLatencyAxis(0)).toBe('0 ms')
  })

  it('rounds whole milliseconds and blanks invalid values', () => {
    expect(formatLatencyAxis(12.4)).toBe('12 ms')
    expect(formatLatencyAxis(Number.NaN)).toBe('')
    expect(formatLatencyAxis(-1)).toBe('')
  })
})
