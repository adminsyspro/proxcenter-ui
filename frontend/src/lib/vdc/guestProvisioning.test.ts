import { beforeEach, describe, expect, it } from 'vitest'

import { beginProvisioning, PROVISIONING_TTL_MS, provisioningState, resetGuestProvisioning } from './guestProvisioning'

beforeEach(() => resetGuestProvisioning())

describe('guest provisioning after a clone (roadmap#265)', () => {
  it('is running until every step is done, then gone', () => {
    const done = beginProvisioning('c1', '101', ['ipam', 'qos'])
    expect(provisioningState('c1', '101')).toEqual({ state: 'running', failures: [] })
    done('ipam')
    expect(provisioningState('c1', '101')).toEqual({ state: 'running', failures: [] })
    done('qos')
    expect(provisioningState('c1', '101')).toBeNull()
  })

  it('reports a failed step once every step is over', () => {
    const done = beginProvisioning('c1', '101', ['ipam', 'qos'])
    done('ipam', 'IPAM allocation failed: subnet exhausted')
    expect(provisioningState('c1', '101')).toEqual({ state: 'running', failures: ['ipam: IPAM allocation failed: subnet exhausted'] })
    done('qos')
    expect(provisioningState('c1', '101')).toEqual({ state: 'failed', failures: ['ipam: IPAM allocation failed: subnet exhausted'] })
  })

  it('is kept per connection and per guest', () => {
    beginProvisioning('c1', '101', ['ipam'])
    expect(provisioningState('c2', '101')).toBeNull()
    expect(provisioningState('c1', '102')).toBeNull()
  })

  it('opens nothing without a step', () => {
    beginProvisioning('c1', '101', [])
    expect(provisioningState('c1', '101')).toBeNull()
  })

  it('a step reported twice or unknown changes nothing', () => {
    const done = beginProvisioning('c1', '101', ['ipam', 'qos'])
    done('ipam')
    done('ipam')
    done('other')
    expect(provisioningState('c1', '101')).toEqual({ state: 'running', failures: [] })
  })

  it('expires when the end of a step is never seen', () => {
    beginProvisioning('c1', '101', ['ipam'], { now: 1000 })
    expect(provisioningState('c1', '101', 1000 + PROVISIONING_TTL_MS - 1)).not.toBeNull()
    expect(provisioningState('c1', '101', 1000 + PROVISIONING_TTL_MS)).toBeNull()
  })
})

describe('a VMID used again (roadmap#265)', () => {
  beforeEach(() => resetGuestProvisioning())

  it('a new clone with nothing to run forgets the failure of an earlier guest with that VMID', () => {
    beginProvisioning('c1', '101', ['ipam'])('ipam', 'subnet exhausted')
    expect(provisioningState('c1', '101')?.state).toBe('failed')
    beginProvisioning('c1', '101', [])
    expect(provisioningState('c1', '101')).toBeNull()
  })
})
