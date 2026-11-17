import { describe, expect, it } from 'vitest'

import { HOST_SUMMARY_TWO_COLUMNS_MIN_WIDTH, hostSummaryRowSx } from './hostSummaryLayout'
import { hostSubscriptionState } from './hostSubscription'

describe('host summary row', () => {
  it('stacks the bars and the system info on a narrow summary', () => {
    expect(hostSummaryRowSx().flexDirection).toBe('column')
  })

  it('puts them side by side once the summary is wide enough, whatever the screen', () => {
    const sx = hostSummaryRowSx() as Record<string, unknown>

    expect(sx[`@container (min-width: ${HOST_SUMMARY_TWO_COLUMNS_MIN_WIDTH}px)`]).toEqual({ flexDirection: 'row' })
  })
})

describe('host subscription state', () => {
  const now = Date.parse('2026-11-16T12:00:00Z')

  it('is expired when the subscription is not active', () => {
    const s = hostSubscriptionState({ status: 'notfound' }, now)

    expect(s.isExpired).toBe(true)
    expect(s.chipColor).toBe('error')
  })

  it('is expiring soon within 30 days of the due date', () => {
    const s = hostSubscriptionState({ status: 'active', nextDueDate: '2026-12-01' }, now)

    expect(s.isExpiringSoon).toBe(true)
    expect(s.isExpired).toBe(false)
    expect(s.daysUntilDue).toBe(15)
    expect(s.chipColor).toBe('warning')
  })

  it('is expired once the due date has passed, even when still reported active', () => {
    expect(hostSubscriptionState({ status: 'active', nextDueDate: '2026-11-01' }, now).isExpired).toBe(true)
  })

  it('is active far from the due date, or without one', () => {
    expect(hostSubscriptionState({ status: 'active', nextDueDate: '2027-06-01' }, now).chipColor).toBe('success')
    expect(hostSubscriptionState({ status: 'active' }, now).chipColor).toBe('success')
  })
})

describe('host subscription level', () => {
  it('names each level for its label and colour', () => {
    const now = Date.parse('2026-11-16T12:00:00Z')

    expect(hostSubscriptionState({ status: 'notfound' }, now).level).toBe('expired')
    expect(hostSubscriptionState({ status: 'active', nextDueDate: '2026-12-01' }, now).level).toBe('expiringSoon')
    expect(hostSubscriptionState({ status: 'active' }, now).level).toBe('active')
  })
})
