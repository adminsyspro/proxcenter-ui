import { describe, it, expect, vi } from 'vitest'

// resolveRrdScope only needs the pure constants/formatters from @/lib/rbac.
// Mock them with faithful reimplementations so the test stays hermetic
// (importing the real barrel pulls next-auth/prisma), matching how the route
// tests stub @/lib/rbac.
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { VM_VIEW: 'vm.view', NODE_VIEW: 'node.view' },
  buildVmResourceId: (c: string, n: string, t: string, v: string) => `${c}:${n}:${t}:${v}`,
  buildNodeResourceId: (c: string, n: string) => `${c}:${n}`,
}))

import { resolveRrdScope } from './rrdScope'

describe('resolveRrdScope', () => {
  it('maps a QEMU path to vm.view on the VM resource', () => {
    expect(resolveRrdScope('conn1', '/nodes/pve1/qemu/100')).toEqual({
      permission: 'vm.view',
      resourceType: 'vm',
      resourceId: 'conn1:pve1:qemu:100',
    })
  })

  it('maps an LXC path to vm.view on the VM resource', () => {
    expect(resolveRrdScope('conn1', '/nodes/pve1/lxc/200')).toEqual({
      permission: 'vm.view',
      resourceType: 'vm',
      resourceId: 'conn1:pve1:lxc:200',
    })
  })

  it('maps a bare node path to node.view on the node resource', () => {
    expect(resolveRrdScope('conn1', '/nodes/pve1')).toEqual({
      permission: 'node.view',
      resourceType: 'node',
      resourceId: 'conn1:pve1',
    })
  })

  it('maps a storage-on-node path to node.view (node-level resource)', () => {
    expect(resolveRrdScope('conn1', '/nodes/pve1/storage/local')).toEqual({
      permission: 'node.view',
      resourceType: 'node',
      resourceId: 'conn1:pve1',
    })
  })

  it('tolerates a trailing slash on the node path', () => {
    expect(resolveRrdScope('conn1', '/nodes/pve1/')).toEqual({
      permission: 'node.view',
      resourceType: 'node',
      resourceId: 'conn1:pve1',
    })
  })

  it('returns null for a non-/nodes path', () => {
    expect(resolveRrdScope('conn1', '/cluster/resources')).toBeNull()
  })

  it('returns null for /nodes with no node name', () => {
    expect(resolveRrdScope('conn1', '/nodes/')).toBeNull()
    expect(resolveRrdScope('conn1', '/nodes')).toBeNull()
  })

  it('falls back to node.view when the guest type is unknown or vmid missing', () => {
    // Not qemu/lxc -> treated as a node-level path.
    expect(resolveRrdScope('conn1', '/nodes/pve1/qemu')).toEqual({
      permission: 'node.view',
      resourceType: 'node',
      resourceId: 'conn1:pve1',
    })
  })
})
