import { describe, expect, it } from 'vitest'

import { runAllChecks, type HardeningData } from '@/lib/compliance/hardening'

import { hasNICFirewall } from './pveDefaults'

describe('hasNICFirewall', () => {
  it('finds firewall=1 on any NIC, whatever its index or position in the string', () => {
    expect(hasNICFirewall({ net0: 'virtio=AA:00,bridge=vmbr0,firewall=1' })).toBe(true)
    expect(hasNICFirewall({ net12: 'firewall=1,virtio=AA:00,bridge=vmbr0' })).toBe(true)
  })

  it('ignores firewall=0, other keys and a missing config', () => {
    expect(hasNICFirewall({ net0: 'virtio=AA:00,bridge=vmbr0,firewall=0' })).toBe(false)
    expect(hasNICFirewall({ description: 'firewall=1', net0: 'virtio=AA:00' })).toBe(false)
    expect(hasNICFirewall(null)).toBe(false)
  })
})

// The cluster policy checks used to read an unset policy as ACCEPT (#1065).
describe('cluster policy hardening checks', () => {
  const check = (firewallOptions: HardeningData['firewallOptions'], id: string) =>
    runAllChecks({ firewallOptions } as HardeningData).find(c => c.id === id)!

  it('treats an unset inbound policy as PVE does, DROP', () => {
    expect(check({ enable: 1 }, 'cluster_policy_in')).toMatchObject({ status: 'pass', details: 'Inbound policy is DROP' })
    expect(check({ enable: 1, policy_in: 'ACCEPT' }, 'cluster_policy_in').status).toBe('fail')
  })

  it('treats an unset outbound policy as PVE does, ACCEPT', () => {
    expect(check({ enable: 1 }, 'cluster_policy_out')).toMatchObject({ status: 'warning', details: expect.stringContaining('is ACCEPT') })
  })

  it('does not pass when the cluster options could not be read', () => {
    expect(check(undefined, 'cluster_policy_in')).toMatchObject({ status: 'fail', details: expect.stringContaining('unknown') })
  })
})
