import { describe, expect, it } from 'vitest'

import { coveragePercent, dashboardPhase, recommendationKinds } from './dashboardModel'

const ready = { connection: true, firewallLoading: false, loadError: false, coverageIn: true, coverageFailed: false, firewallOn: true, stopStateIn: true }

describe('coveragePercent', () => {
  it('leaves the unknown guests out and says nothing when none could be told', () => {
    expect(coveragePercent({ enabled: 3, disabled: 1, unknown: 6, measured: 10, total: 10 })).toBe(75)
    expect(coveragePercent({ enabled: 0, disabled: 0, unknown: 4, measured: 4, total: 4 })).toBeNull()
    expect(coveragePercent(null)).toBeNull()
  })
})

describe('dashboardPhase', () => {
  it('shows everything once every read is in', () => {
    expect(dashboardPhase(ready)).toEqual({ hero: 'ready', advice: 'ready' })
  })

  it('waits for the firewall data and for the coverage', () => {
    expect(dashboardPhase({ ...ready, firewallLoading: true })).toEqual({ hero: 'loading', advice: 'loading' })
    expect(dashboardPhase({ ...ready, coverageIn: false })).toEqual({ hero: 'loading', advice: 'loading' })
  })

  it('waits for the stop state before advising on a firewall that is off, not on one that is on', () => {
    expect(dashboardPhase({ ...ready, firewallOn: false, stopStateIn: false })).toEqual({ hero: 'ready', advice: 'loading' })
    expect(dashboardPhase({ ...ready, stopStateIn: false })).toEqual({ hero: 'ready', advice: 'ready' })
  })

  it('says not available on a failed load or a failed coverage', () => {
    expect(dashboardPhase({ ...ready, loadError: true })).toEqual({ hero: 'unavailable', advice: 'unavailable' })
    expect(dashboardPhase({ ...ready, coverageIn: false, coverageFailed: true })).toEqual({ hero: 'unavailable', advice: 'unavailable' })
  })

  it('waits for nothing without a connection', () => {
    expect(dashboardPhase({ ...ready, connection: false, coverageIn: false, stopStateIn: false })).toEqual({ hero: 'ready', advice: 'ready' })
  })
})

describe('recommendationKinds', () => {
  it('says the stop holds the firewall off instead of "enable the firewall"', () => {
    expect(recommendationKinds({ firewallOn: false, stopHoldsFirewall: true, policyIn: 'DROP', unprotected: 0 })).toEqual(['stopHeld'])
    expect(recommendationKinds({ firewallOn: false, stopHoldsFirewall: false, policyIn: 'DROP', unprotected: 0 })).toEqual(['firewallOff'])
  })

  it('lists the permissive policy and the unprotected guests, or says all is well', () => {
    expect(recommendationKinds({ firewallOn: true, stopHoldsFirewall: false, policyIn: 'ACCEPT', unprotected: 2 })).toEqual(['policyIn', 'vms'])
    expect(recommendationKinds({ firewallOn: true, stopHoldsFirewall: false, policyIn: 'DROP', unprotected: 0 })).toEqual(['ok'])
  })
})
