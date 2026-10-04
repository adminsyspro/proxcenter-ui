import { describe, expect, it } from 'vitest'

import { leaseDaysLeft } from './leaseDays'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const NOW = Date.parse('2026-09-29T00:00:00.000Z')

describe('leaseDaysLeft', () => {
  const cases = [
    ['no date at all', null, null],
    ['undefined date', undefined, null],
    ['empty string', '', null],
    ['unparseable date', 'not-a-date', null],
    ['already ended (ms == 0)', new Date(NOW).toISOString(), null],
    ['already ended (ms < 0)', new Date(NOW - 1).toISOString(), null],
    ['a minute left', new Date(NOW + 60 * 1000).toISOString(), 0],
    ['just under a day left', new Date(NOW + DAY_MS - 1).toISOString(), 0],
    ['exactly a day left rounds up to 1', new Date(NOW + DAY_MS).toISOString(), 1],
    ['a day and a few minutes left', new Date(NOW + DAY_MS + 10 * 60 * 1000).toISOString(), 1],
    ['a lease issued minutes ago still shows its full 30 days', new Date(NOW + 30 * DAY_MS - 5 * 60 * 1000).toISOString(), 30],
    ['exactly 30 days left', new Date(NOW + 30 * DAY_MS).toISOString(), 30],
  ]

  for (const [label, until, expected] of cases) {
    it(label, () => {
      expect(leaseDaysLeft(until, NOW)).toBe(expected)
    })
  }

  it('defaults now to Date.now() when omitted', () => {
    expect(leaseDaysLeft(new Date(Date.now() - 1000).toISOString())).toBe(null)
  })
})
