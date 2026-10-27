import { describe, expect, it } from 'vitest'

import { availabilityErrorKind } from './errorKind'

describe('availabilityErrorKind', () => {
  it('maps the status of the shared fetcher error', () => {
    expect(availabilityErrorKind(new Error('API error: 503'))).toBe('unavailable')
    expect(availabilityErrorKind(new Error('API error: 403'))).toBe('forbidden')
    expect(availabilityErrorKind(new Error('API error: 500'))).toBe('generic')
    expect(availabilityErrorKind(new Error('Invalid JSON response from /x'))).toBe('generic')
    expect(availabilityErrorKind('boom')).toBe('generic')
  })
})
