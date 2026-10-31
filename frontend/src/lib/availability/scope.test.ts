import { describe, expect, it } from 'vitest'

import type { RbacInfraScope } from '@/lib/rbac/infraScope'
import type { VdcScope } from '@/lib/vdc/scope'

import { allowsInfraRef, allowsNode, connScope, narrowByRbac, toAvailabilityScope } from './scope'

function vdcScope(): VdcScope {
  return {
    connectionIds: new Set(['c1']),
    nodesByConnection: new Map([['c1', new Set(['pve2', 'pve1'])]]),
    poolsByConnection: new Map([['c1', new Set(['pool-b', 'pool-a'])]]),
  } as unknown as VdcScope
}

function rbac(partial: Partial<RbacInfraScope>): RbacInfraScope {
  return { fullConnections: new Set(), nodesByConnection: new Map(), guestDerived: false, ...partial }
}

describe('toAvailabilityScope', () => {
  it('provider: null, everything visible', () => {
    expect(toAvailabilityScope({ kind: 'provider' })).toBeNull()
  })

  it('msp: every owned connection whole', () => {
    expect(toAvailabilityScope({ kind: 'msp', connectionIds: new Set(['c1', 'c2']) })).toEqual({
      connections: { c1: { all: true }, c2: { all: true } },
    })
  })

  it('iaas: the vDC nodes and pools, never the whole connection', () => {
    expect(toAvailabilityScope({ kind: 'iaas', vdcScope: vdcScope() })).toEqual({
      connections: { c1: { all: false, nodes: ['pve1', 'pve2'], pools: ['pool-a', 'pool-b'] } },
    })
  })

  it('iaas without any vDC: no connection at all', () => {
    const empty = { connectionIds: new Set(), nodesByConnection: new Map(), poolsByConnection: new Map() } as unknown as VdcScope
    expect(toAvailabilityScope({ kind: 'iaas', vdcScope: empty })).toEqual({ connections: {} })
  })
})

describe('connScope / allowsNode', () => {
  const scope = { connections: { c1: { all: false, nodes: ['pve1'], pools: [] } } }

  it('mirrors the Go Scope', () => {
    expect(connScope(null, 'any')).toEqual({ all: true })
    expect(connScope(scope, 'c2')).toBeNull()
    expect(connScope(scope, 'constructor')).toBeNull()
    expect(allowsNode(null, 'c9', 'x')).toBe(true)
    expect(allowsNode(scope, 'c1', 'pve1')).toBe(true)
    expect(allowsNode(scope, 'c1', 'pve2')).toBe(false)
    expect(allowsNode(scope, 'c2', 'pve1')).toBe(false)
  })
})

describe('narrowByRbac', () => {
  it('keeps the perimeter when the user is unrestricted', () => {
    expect(narrowByRbac(null, ['c1', 'c2'], null)).toEqual({ scope: null, connectionIds: ['c1', 'c2'] })
  })

  it('keeps the connections granted whole, drops the others', () => {
    const out = narrowByRbac(null, ['c1', 'c2'], rbac({ fullConnections: new Set(['c2']) }))
    expect(out).toEqual({ scope: { connections: { c2: { all: true } } }, connectionIds: ['c2'] })
  })

  it('narrows a node grant to its nodes, without the cluster nor any guest', () => {
    const out = narrowByRbac(null, ['c1'], rbac({ nodeGrantsByConnection: new Map([['c1', new Set(['pve1'])]]) }))
    expect(out.scope).toEqual({ connections: { c1: { all: false, nodes: ['pve1'], pools: [] } } })
  })

  it('intersects a node grant with the vDC nodes', () => {
    const tenant = { connections: { c1: { all: false, nodes: ['pve1', 'pve2'], pools: ['pool-a'] } } }
    const out = narrowByRbac(tenant, ['c1'], rbac({ nodeGrantsByConnection: new Map([['c1', new Set(['pve2', 'pve9'])]]) }))
    expect(out.scope).toEqual({ connections: { c1: { all: false, nodes: ['pve2'], pools: [] } } })
    const none = narrowByRbac(tenant, ['c1'], rbac({ nodeGrantsByConnection: new Map([['c1', new Set(['pve9'])]]) }))
    expect(none).toEqual({ scope: { connections: {} }, connectionIds: [] })
  })

  it('fails closed on tag, pool or vm grants only', () => {
    const out = narrowByRbac(null, ['c1'], rbac({
      guestDerived: true,
      nodesByConnection: new Map([['c1', new Set(['pve1'])]]),
      nodeGrantsByConnection: new Map(),
    }))
    expect(out).toEqual({ scope: { connections: {} }, connectionIds: [] })
  })

  it('never widens the tenant perimeter', () => {
    const tenant = { connections: { c1: { all: true } } }
    const out = narrowByRbac(tenant, ['c1', 'c2'], rbac({ fullConnections: new Set(['c1', 'c2']) }))
    expect(out.connectionIds).toEqual(['c1'])
  })
})

describe('allowsInfraRef', () => {
  const iaas = { connections: { c1: { all: false, nodes: ['pve1'], pools: ['pool-a'] } } }

  it('the cluster with the whole connection only, the visible nodes, never a guest', () => {
    expect(allowsInfraRef(null, { connection_id: 'c1', kind: 'cluster' })).toBe(true)
    expect(allowsInfraRef(iaas, { connection_id: 'c1', kind: 'cluster' })).toBe(false)
    expect(allowsInfraRef(iaas, { connection_id: 'c1', kind: 'node', node: 'pve1' })).toBe(true)
    expect(allowsInfraRef(iaas, { connection_id: 'c1', kind: 'node', node: 'pve2' })).toBe(false)
    expect(allowsInfraRef(iaas, { connection_id: 'c1', kind: 'node' })).toBe(false)
    expect(allowsInfraRef(null, { connection_id: 'c1', kind: 'guest', vmid: 100 })).toBe(false)
  })
})
