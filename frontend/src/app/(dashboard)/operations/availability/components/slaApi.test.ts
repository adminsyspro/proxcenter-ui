import { describe, expect, it } from 'vitest'

import { errorCodeOf, policyStatus, SlaApiError } from './slaApi'

const summary = (availability: number | null, remaining: number | null, allowed = 400) => ({
  up_seconds: 0,
  down_seconds: 0,
  unobserved_seconds: 0,
  availability,
  coverage: 100,
  below_target: 0,
  budget: remaining === null ? null : { allowed_seconds: allowed, used_seconds: allowed - remaining, remaining_seconds: remaining },
})

describe('policyStatus', () => {
  it('is unmeasured without an availability or a summary', () => {
    expect(policyStatus(summary(null, 100), 99.9)).toBe('unmeasured')
    expect(policyStatus(null, 99.9)).toBe('unmeasured')
  })

  it('is violated under the target, even with budget left', () => {
    expect(policyStatus(summary(99.89, 300), 99.9)).toBe('violated')
  })

  it('is met just above 25% of the budget left', () => {
    expect(policyStatus(summary(99.95, 101), 99.9)).toBe('met')
  })

  it('is at risk at exactly 25% of the budget left', () => {
    expect(policyStatus(summary(99.95, 100), 99.9)).toBe('atRisk')
  })

  it('is at risk under 25% and at the target itself', () => {
    expect(policyStatus(summary(99.9, 0), 99.9)).toBe('atRisk')
  })

  it('is met at the target without a budget', () => {
    expect(policyStatus(summary(99.9, null), 99.9)).toBe('met')
  })
})

describe('errorCodeOf', () => {
  it('keeps a code that has a text and collapses the others', () => {
    expect(errorCodeOf(new SlaApiError('guest_out_of_scope'))).toBe('guest_out_of_scope')
    expect(errorCodeOf(new SlaApiError('boom_code'))).toBe('generic')
    expect(errorCodeOf(new SlaApiError('not_found'))).toBe('not_found')
    expect(errorCodeOf(new SlaApiError('forbidden'))).toBe('forbidden')
    expect(errorCodeOf(new Error('boom'))).toBe('generic')
  })
})
