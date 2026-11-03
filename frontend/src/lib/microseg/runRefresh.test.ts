import { describe, expect, it } from 'vitest'

import { isRunAffectedKey, zoneGuestsUrl } from './runRefresh'

describe('isRunAffectedKey', () => {
  const matches = isRunAffectedKey('c 1')
  const base = '/api/v1/firewall/microseg/c%201'

  it('matches what a finished run can make stale on its connection', () => {
    expect(matches(`${base}/status`)).toBe(true)
    expect(matches(`${base}/drifts`)).toBe(true)
    expect(matches([`${base}/runs`, 11, 0])).toBe(true)
    expect(matches(`${base}/runs/r1`)).toBe(true)
    expect(matches(`${base}/revisions?limit=100`)).toBe(true)
    expect(matches(`${base}/revisions?limit=1#rev-2`)).toBe(true)
    expect(matches('/api/v1/vms?connId=c%201')).toBe(true)
  })

  it('leaves the other keys and the other connections alone', () => {
    expect(matches(`${base}/policy`)).toBe(false)
    expect(matches([`${base}/suggestions`, undefined, 'pending'])).toBe(false)
    expect(matches('/api/v1/firewall/microseg/c2/status')).toBe(false)
    expect(matches('/api/v1/vms?connId=c2')).toBe(false)
    expect(matches(null)).toBe(false)
    expect(matches([42])).toBe(false)
  })

  it('builds the inventory read of the zone members', () => {
    expect(zoneGuestsUrl('a/b')).toBe('/api/v1/vms?connId=a%2Fb')
  })
})
