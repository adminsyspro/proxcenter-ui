import { describe, expect, it } from 'vitest'

import { heldByStop, opensWizard, parseRate, preflightMessage } from './preflightModel'

describe('parseRate', () => {
  it('splits the rate PVE writes into a count and a unit', () => {
    expect(parseRate('20/second')).toEqual({ count: 20, unit: 'second' })
    expect(parseRate(' 3 / day ')).toEqual({ count: 3, unit: 'day' })
    expect(parseRate('1/hour')).toEqual({ count: 1, unit: 'hour' })
  })

  it('gives up on anything else', () => {
    expect(parseRate(undefined)).toBeNull()
    expect(parseRate('')).toBeNull()
    expect(parseRate('20/fortnight')).toBeNull()
    expect(parseRate('fast')).toBeNull()
  })
})

describe('a cluster firewall the emergency stop holds off', () => {
  const held = { id: 'cluster_firewall', status: 'warn' as const, fix: 'enable_cluster_firewall', detail: { reason: 'emergency_stop', held_by_stop: true } }
  const off = { id: 'cluster_firewall', status: 'fail' as const, fix: 'enable_cluster_firewall' }

  it('is told apart from a firewall that is simply off, by held_by_stop alone', () => {
    expect(heldByStop(held)).toBe(true)
    expect(heldByStop({ ...held, detail: { reason: 'emergency_stop' } })).toBe(false)
    expect(heldByStop({ ...held, detail: { held_by_stop: true } })).toBe(true)
    expect(heldByStop(off)).toBe(false)
    expect(heldByStop({ ...held, status: 'pass' })).toBe(false)
    expect(heldByStop({ ...held, id: 'socle_rules' })).toBe(false)
  })

  it('says it is held by the stop and does not offer the wizard', () => {
    expect(preflightMessage(held).detail).toEqual({ key: 'checks.cluster_firewall.heldByStop' })
    expect(opensWizard(held)).toBe(false)
  })

  it('keeps the wizard for a firewall that is off', () => {
    expect(preflightMessage(off).detail).toEqual({ key: 'checks.cluster_firewall.off' })
    expect(opensWizard(off)).toBe(true)
  })
})

describe('the ProxCenter address check that could not look at every member', () => {
  const unchecked = (reason: string, n = 3) => ({ id: 'self_in_zone', status: 'warn' as const, detail: { unchecked: n, reason } })

  it('says how many members were not checked, and why', () => {
    expect(preflightMessage(unchecked('collect_timeout')).detail).toEqual({ key: 'checks.self_in_zone.uncheckedTimeout', values: { count: 3 } })
    expect(preflightMessage(unchecked('collect_cap', 1)).detail).toEqual({ key: 'checks.self_in_zone.uncheckedCap', values: { count: 1 } })
  })

  it('keeps the zone wording when the address was found in a zone', () => {
    const hit = { id: 'self_in_zone', status: 'warn' as const, detail: { zone: 'web', self_ip: '10.0.0.5' } }
    expect(preflightMessage(hit).detail).toEqual({ key: 'checks.self_in_zone.inZone', values: { zone: 'web', self_ip: '10.0.0.5' } })
  })
})
