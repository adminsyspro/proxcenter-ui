// frontend/src/lib/rbac/infraScope.test.ts
import { describe, it, expect } from 'vitest'
import { deriveRbacInfraScope, isConnectionVisible, applyRbacInfraFilter, filterVisibleConnections } from './infraScope'

describe('deriveRbacInfraScope', () => {
  it('returns null (unrestricted) for super admins', () => {
    expect(deriveRbacInfraScope({ superAdmin: true, byScope: [] })).toBeNull()
  })

  it('returns null when any global scope is present', () => {
    const s = deriveRbacInfraScope({ superAdmin: false, byScope: [{ scopeType: 'global', scopeTarget: null }] })
    expect(s).toBeNull()
  })

  it('maps a node scope to nodesByConnection (only that node)', () => {
    const s = deriveRbacInfraScope({ superAdmin: false, byScope: [{ scopeType: 'node', scopeTarget: 'connA:nodeX' }] })!
    expect(s.fullConnections.size).toBe(0)
    expect([...s.nodesByConnection.get('connA')!]).toEqual(['nodeX'])
  })

  it('maps a connection scope to fullConnections (all nodes)', () => {
    const s = deriveRbacInfraScope({ superAdmin: false, byScope: [{ scopeType: 'connection', scopeTarget: 'connA' }] })!
    expect(s.fullConnections.has('connA')).toBe(true)
    expect(s.nodesByConnection.has('connA')).toBe(false)
  })

  it('derives connId+node from a vm scope target', () => {
    const s = deriveRbacInfraScope({ superAdmin: false, byScope: [{ scopeType: 'vm', scopeTarget: 'connA:nodeX:qemu:100' }] })!
    expect([...s.nodesByConnection.get('connA')!]).toEqual(['nodeX'])
  })

  it('ignores tag/pool scopes (Decision 2: not infra)', () => {
    const s = deriveRbacInfraScope({ superAdmin: false, byScope: [
      { scopeType: 'tag', scopeTarget: 'prod' },
      { scopeType: 'pool', scopeTarget: 'poolA' },
    ] })!
    expect(s.fullConnections.size).toBe(0)
    expect(s.nodesByConnection.size).toBe(0)
  })

  it('mixed node + tag keeps only the node-derived connection', () => {
    const s = deriveRbacInfraScope({ superAdmin: false, byScope: [
      { scopeType: 'node', scopeTarget: 'connA:nodeX' },
      { scopeType: 'tag', scopeTarget: 'prod' },
    ] })!
    expect([...s.nodesByConnection.keys()]).toEqual(['connA'])
  })
})

describe('isConnectionVisible', () => {
  it('true for a full connection and for a node-scoped connection, false otherwise', () => {
    const s = { fullConnections: new Set(['connA']), nodesByConnection: new Map([['connB', new Set(['n1'])]]) }
    expect(isConnectionVisible(s, 'connA')).toBe(true)
    expect(isConnectionVisible(s, 'connB')).toBe(true)
    expect(isConnectionVisible(s, 'connC')).toBe(false)
  })
})

describe('filterVisibleConnections', () => {
  const items = [{ id: 'connA' }, { id: 'connB' }, { id: 'connC' }]

  it('returns the same list when scope is null (admin/unrestricted)', () => {
    expect(filterVisibleConnections(items, null)).toBe(items)
  })

  it('keeps only items whose id is visible under a full-connection scope', () => {
    const s = { fullConnections: new Set(['connA']), nodesByConnection: new Map() }
    expect(filterVisibleConnections(items, s).map(x => x.id)).toEqual(['connA'])
  })

  it('keeps items reachable via node-scope (nodesByConnection), drops others', () => {
    const s = { fullConnections: new Set<string>(), nodesByConnection: new Map([['connB', new Set(['n1'])]]) }
    expect(filterVisibleConnections(items, s).map(x => x.id)).toEqual(['connB'])
  })

  it('returns empty list when scope matches nothing', () => {
    const s = { fullConnections: new Set<string>(), nodesByConnection: new Map() }
    expect(filterVisibleConnections(items, s)).toHaveLength(0)
  })
})

describe('applyRbacInfraFilter', () => {
  const cluster = { id: 'connB', nodes: [{ node: 'n1' }, { node: 'n2' }] }

  it('null scope returns the cluster unchanged', () => {
    expect(applyRbacInfraFilter(cluster, null)).toBe(cluster)
  })

  it('full connection returns all nodes', () => {
    const s = { fullConnections: new Set(['connB']), nodesByConnection: new Map() }
    expect(applyRbacInfraFilter(cluster, s).nodes).toHaveLength(2)
  })

  it('node-scoped connection keeps only allowed nodes', () => {
    const s = { fullConnections: new Set<string>(), nodesByConnection: new Map([['connB', new Set(['n1'])]]) }
    expect(applyRbacInfraFilter(cluster, s).nodes.map(n => n.node)).toEqual(['n1'])
  })

  it('non-visible connection is emptied', () => {
    const s = { fullConnections: new Set<string>(), nodesByConnection: new Map([['connOther', new Set(['x'])]]) }
    expect(applyRbacInfraFilter(cluster, s).nodes).toHaveLength(0)
  })
})
