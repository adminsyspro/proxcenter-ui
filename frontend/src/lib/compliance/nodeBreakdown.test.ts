import { describe, it, expect } from 'vitest'
import { computeNodeBreakdown } from './nodeBreakdown'
import type { HardeningData } from './hardening'

describe('computeNodeBreakdown', () => {
  const baseData: HardeningData = {
    nodes: [
      { node: 'pve1', status: 'online' },
      { node: 'pve2', status: 'online' },
    ],
    nodeDetails: {
      pve1: { firewall: { enable: 1 }, subscription: { status: 'Active', level: 'b' } },
      pve2: { firewall: { enable: 0 }, subscription: { status: 'Active', level: 'b' } },
    },
    sshData: {
      nodes: [
        {
          node: 'pve1',
          available: true,
          sections: {
            sshd_config: 'PermitRootLogin no\nPasswordAuthentication yes',
          },
        },
        {
          node: 'pve2',
          available: true,
          sections: {
            sshd_config: 'PermitRootLogin yes\nPasswordAuthentication yes',
          },
        },
      ],
    },
    resources: [
      { type: 'qemu', vmid: 100, node: 'pve1', name: 'vm-pve1', id: 'qemu/100' },
      { type: 'qemu', vmid: 200, node: 'pve2', name: 'vm-pve2', id: 'qemu/200' },
    ],
    vmConfigs: {
      'pve1/qemu/100': { bios: 'ovmf', net0: 'virtio,tag=10' },
      'pve2/qemu/200': { bios: 'seabios', net0: 'virtio' },
    },
    // Cluster-level fields
    firewallOptions: { enable: 1, policy_in: 'DROP' },
    version: { version: '8.1.0' },
    users: [{ userid: 'root@pam', enable: 1 }],
    tfa: [],
    backupJobs: [{ id: 'backup-1', enabled: 1 }],
    haResources: [],
    replicationJobs: [],
    pools: [],
  }

  it('(a) returns one NodeBreakdown per node', () => {
    const result = computeNodeBreakdown(baseData)
    expect(result).toHaveLength(2)
    expect(result.map(r => r.node)).toEqual(['pve1', 'pve2'])
  })

  it('(b) ssh_root_login check differs between nodes based on their sshd_config', () => {
    const result = computeNodeBreakdown(baseData)

    const pve1 = result.find(r => r.node === 'pve1')!
    const pve2 = result.find(r => r.node === 'pve2')!

    const rootLoginPve1 = pve1.checks.find(c => c.id === 'ssh_root_login')
    const rootLoginPve2 = pve2.checks.find(c => c.id === 'ssh_root_login')

    // pve1 has PermitRootLogin no -- should pass
    expect(rootLoginPve1).toBeDefined()
    expect(rootLoginPve1!.status).toBe('pass')

    // pve2 has PermitRootLogin yes -- should warn (ssh_root_login uses 'warning' not 'fail')
    expect(rootLoginPve2).toBeDefined()
    expect(rootLoginPve2!.status).toBe('warning')
  })

  it('(c) no check with category === cluster appears in any node breakdown', () => {
    const result = computeNodeBreakdown(baseData)
    for (const breakdown of result) {
      const clusterChecks = breakdown.checks.filter(c => c.category === 'cluster')
      expect(clusterChecks).toHaveLength(0)
    }
  })

  it('returns empty array when data.nodes is undefined', () => {
    const result = computeNodeBreakdown({})
    expect(result).toHaveLength(0)
  })

  it('filters vmConfigs to only include keys for the given node', () => {
    const result = computeNodeBreakdown(baseData)
    // pve1 has one VM with VLAN tag -- vm_vlan_isolation should pass
    // pve2 has one VM without VLAN tag -- vm_vlan_isolation should fail/warn
    const pve1 = result.find(r => r.node === 'pve1')!
    const pve2 = result.find(r => r.node === 'pve2')!

    const vlanPve1 = pve1.checks.find(c => c.id === 'vm_vlan_isolation')
    const vlanPve2 = pve2.checks.find(c => c.id === 'vm_vlan_isolation')

    expect(vlanPve1).toBeDefined()
    expect(vlanPve2).toBeDefined()
    // pve1 has tag -- pass; pve2 does not -- fail
    expect(vlanPve1!.status).toBe('pass')
    expect(vlanPve2!.status).toBe('fail')
  })
})
