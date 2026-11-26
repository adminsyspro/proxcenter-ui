import { describe, expect, it } from 'vitest'

import { acceptanceLineValues, acceptancePayload, isJustificationValid, JUSTIFICATION_MAX_LENGTH, tomorrowIso } from './riskAcceptance.helpers'

describe('isJustificationValid', () => {
  it('wants 10 to 1000 characters once trimmed', () => {
    expect(isJustificationValid('   short   ')).toBe(false)
    expect(isJustificationValid('long enough')).toBe(true)
    expect(isJustificationValid('x'.repeat(JUSTIFICATION_MAX_LENGTH))).toBe(true)
    expect(isJustificationValid('x'.repeat(JUSTIFICATION_MAX_LENGTH + 1))).toBe(false)
  })
})

describe('tomorrowIso', () => {
  it('is the next local day, across a month and a year end', () => {
    expect(tomorrowIso(new Date(2026, 10, 25, 23, 30))).toBe('2026-11-26')
    expect(tomorrowIso(new Date(2026, 10, 30, 8, 0))).toBe('2026-12-01')
    expect(tomorrowIso(new Date(2026, 11, 31, 8, 0))).toBe('2027-01-01')
  })
})

describe('acceptancePayload', () => {
  it('sends no expiry when no day was picked', () => {
    expect(acceptancePayload('node_firewalls', '  Handled elsewhere  ', '')).toEqual({ check_id: 'node_firewalls', justification: 'Handled elsewhere', expires_at: null })
  })

  it('counts the picked day until its last second, local time', () => {
    const { expires_at } = acceptancePayload('node_firewalls', 'Handled elsewhere', '2027-02-23')
    expect(expires_at).toBe(new Date(2027, 1, 23, 23, 59, 59).toISOString())
  })

  it('drops a day that is not a date', () => {
    expect(acceptancePayload('node_firewalls', 'Handled elsewhere', 'not-a-day').expires_at).toBeNull()
  })
})

describe('acceptanceLineValues', () => {
  const format = (d: Date) => d.toISOString().slice(0, 10)

  it('gives the user, the day, and the expiry day when there is one', () => {
    const a = { justification: 'x', acceptedBy: 'admin@example.test', acceptedAt: '2026-11-25T10:00:00.000Z', expiresAt: '2027-02-23T22:59:59.000Z' }
    expect(acceptanceLineValues(a, format)).toEqual({ user: 'admin@example.test', date: '2026-11-25', until: '2027-02-23' })
    expect(acceptanceLineValues({ ...a, expiresAt: null }, format)).toEqual({ user: 'admin@example.test', date: '2026-11-25', until: null })
  })

  it('formats in the reader locale by default', () => {
    const a = { justification: 'x', acceptedBy: 'u', acceptedAt: '2026-11-25T10:00:00.000Z', expiresAt: null }
    expect(acceptanceLineValues(a).date).toBe(new Date(a.acceptedAt).toLocaleDateString())
  })
})
