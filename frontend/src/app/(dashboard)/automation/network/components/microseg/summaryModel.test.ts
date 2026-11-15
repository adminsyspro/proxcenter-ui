import { describe, expect, it } from 'vitest'

import { formatWhen, stillPaused } from './summaryModel'
import { status } from './microsegTestKit'

describe('stillPaused', () => {
  it('is true while the end of the pause is ahead', () => {
    expect(stillPaused(new Date(Date.now() + 60_000).toISOString())).toBe(true)
  })

  it('is false once the end is past, when there is no pause, or when the date is unreadable', () => {
    expect(stillPaused(new Date(Date.now() - 60_000).toISOString())).toBe(false)
    expect(stillPaused(null)).toBe(false)
    expect(stillPaused(undefined)).toBe(false)
    expect(stillPaused('')).toBe(false)
  })
})

describe('formatWhen', () => {
  const format = { dateTime: (d: Date) => `at ${d.toISOString()}` } as never

  it('formats a date', () => {
    expect(formatWhen(format, '2026-11-02T10:00:00Z')).toBe('at 2026-11-02T10:00:00.000Z')
  })

  it('returns the raw text when it is not a date', () => {
    expect(formatWhen(format, 'soon')).toBe('soon')
  })
})
