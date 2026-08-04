// frontend/src/lib/rbac/infraScope.test.ts
import { describe, it, expect } from 'vitest'
import { deriveRbacInfraScope, isConnectionVisible, applyRbacInfraFilter, filterVisibleConnections, mayHaveVisibleGuests, filterCandidateConnections, pruneEmptyConnections, tokenInfraScope } from './infraScope'

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

  it('marks tag/pool scopes as guest-derived, with no infra sets', () => {
    const s = deriveRbacInfraScope({ superAdmin: false, byScope: [
      { scopeType: 'tag', scopeTarget: 'prod' },
      { scopeType: 'pool', scopeTarget: 'poolA' },
    ] })!
    expect(s.fullConnections.size).toBe(0)
    expect(s.nodesByConnection.size).toBe(0)
    expect(s.guestDerived).toBe(true)
  })

  it('mixed node + tag keeps the node grant AND stays guest-derived', () => {
    const s = deriveRbacInfraScope({ superAdmin: false, byScope: [
      { scopeType: 'node', scopeTarget: 'connA:nodeX' },
      { scopeType: 'tag', scopeTarget: 'prod' },
    ] })!
    expect([...s.nodesByConnection.keys()]).toEqual(['connA'])
    expect(s.guestDerived).toBe(true)
  })

  it('is not guest-derived without any tag/pool grant', () => {
    const s = deriveRbacInfraScope({ superAdmin: false, byScope: [
      { scopeType: 'connection', scopeTarget: 'connA' },
    ] })!
    expect(s.guestDerived).toBe(false)
  })

  it('ignores a tag/pool grant with an empty target', () => {
    const s = deriveRbacInfraScope({ superAdmin: false, byScope: [
      { scopeType: 'tag', scopeTarget: '' },
    ] })!
    expect(s.guestDerived).toBe(false)
  })
})

describe('isConnectionVisible', () => {
  it('true for a full connection and for a node-scoped connection, false otherwise', () => {
    const s = { fullConnections: new Set(['connA']), nodesByConnection: new Map([['connB', new Set(['n1'])]]), guestDerived: false }
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
    const s = { fullConnections: new Set(['connA']), nodesByConnection: new Map(), guestDerived: false }
    expect(filterVisibleConnections(items, s).map(x => x.id)).toEqual(['connA'])
  })

  it('keeps items reachable via node-scope (nodesByConnection), drops others', () => {
    const s = { fullConnections: new Set<string>(), nodesByConnection: new Map([['connB', new Set(['n1'])]]), guestDerived: false }
    expect(filterVisibleConnections(items, s).map(x => x.id)).toEqual(['connB'])
  })

  it('returns empty list when scope matches nothing', () => {
    const s = { fullConnections: new Set<string>(), nodesByConnection: new Map(), guestDerived: false }
    expect(filterVisibleConnections(items, s)).toHaveLength(0)
  })

  it('stays strict for a guest-derived scope (PBS and external hypervisors)', () => {
    const s = { fullConnections: new Set<string>(), nodesByConnection: new Map(), guestDerived: true }
    expect(filterVisibleConnections(items, s)).toHaveLength(0)
  })
})

describe('applyRbacInfraFilter', () => {
  const cluster = { id: 'connB', nodes: [{ node: 'n1' }, { node: 'n2' }] }

  it('null scope returns the cluster unchanged', () => {
    expect(applyRbacInfraFilter(cluster, null)).toBe(cluster)
  })

  it('full connection returns all nodes', () => {
    const s = { fullConnections: new Set(['connB']), nodesByConnection: new Map(), guestDerived: false }
    expect(applyRbacInfraFilter(cluster, s).nodes).toHaveLength(2)
  })

  it('node-scoped connection keeps only allowed nodes', () => {
    const s = { fullConnections: new Set<string>(), nodesByConnection: new Map([['connB', new Set(['n1'])]]), guestDerived: false }
    expect(applyRbacInfraFilter(cluster, s).nodes.map(n => n.node)).toEqual(['n1'])
  })

  it('non-visible connection is emptied', () => {
    const s = { fullConnections: new Set<string>(), nodesByConnection: new Map([['connOther', new Set(['x'])]]), guestDerived: false }
    expect(applyRbacInfraFilter(cluster, s).nodes).toHaveLength(0)
  })
})

describe('mayHaveVisibleGuests', () => {
  it('is true for a guest-derived scope on any connection', () => {
    const s = { fullConnections: new Set<string>(), nodesByConnection: new Map(), guestDerived: true }
    expect(mayHaveVisibleGuests(s, 'connZ')).toBe(true)
  })

  it('falls back to strict visibility when not guest-derived', () => {
    const s = { fullConnections: new Set(['connA']), nodesByConnection: new Map(), guestDerived: false }
    expect(mayHaveVisibleGuests(s, 'connA')).toBe(true)
    expect(mayHaveVisibleGuests(s, 'connZ')).toBe(false)
  })
})

describe('filterCandidateConnections', () => {
  const items = [{ id: 'connA' }, { id: 'connB' }]

  it('keeps everything for a guest-derived scope', () => {
    const s = { fullConnections: new Set<string>(), nodesByConnection: new Map(), guestDerived: true }
    expect(filterCandidateConnections(items, s)).toEqual(items)
  })

  it('is strict when not guest-derived', () => {
    const s = { fullConnections: new Set(['connA']), nodesByConnection: new Map(), guestDerived: false }
    expect(filterCandidateConnections(items, s)).toEqual([{ id: 'connA' }])
  })

  it('is a no-op for a null scope', () => {
    expect(filterCandidateConnections(items, null)).toEqual(items)
  })
})

describe('applyRbacInfraFilter with a guest-derived scope', () => {
  const cluster = {
    id: 'connA',
    nodes: [
      { node: 'n1', guests: [{ vmid: 100 }] },
      { node: 'n2', guests: [] },
      { node: 'n3', guests: [{ vmid: 200 }] },
    ],
  }

  it('keeps only nodes that still host a visible guest', () => {
    const s = { fullConnections: new Set<string>(), nodesByConnection: new Map(), guestDerived: true }
    expect(applyRbacInfraFilter(cluster, s).nodes.map(n => n.node)).toEqual(['n1', 'n3'])
  })

  it('unions an explicit node grant with the guest-derived nodes', () => {
    const s = {
      fullConnections: new Set<string>(),
      nodesByConnection: new Map([['connA', new Set(['n2'])]]),
      guestDerived: true,
    }
    expect(applyRbacInfraFilter(cluster, s).nodes.map(n => n.node)).toEqual(['n1', 'n2', 'n3'])
  })

  it('still empties a non-visible connection when not guest-derived', () => {
    const s = { fullConnections: new Set<string>(), nodesByConnection: new Map(), guestDerived: false }
    expect(applyRbacInfraFilter(cluster, s).nodes).toEqual([])
  })

  it('keeps every node of a full-connection grant, guest-derived or not', () => {
    const s = { fullConnections: new Set(['connA']), nodesByConnection: new Map(), guestDerived: true }
    expect(applyRbacInfraFilter(cluster, s).nodes.map(n => n.node)).toEqual(['n1', 'n2', 'n3'])
  })
})

describe('pruneEmptyConnections', () => {
  it('drops connections left with no node, keeps explicitly granted empty ones', () => {
    const s = { fullConnections: new Set(['connB']), nodesByConnection: new Map(), guestDerived: true }
    const clusters = [
      { id: 'connA', nodes: [] as Array<{ node: string }> },
      { id: 'connB', nodes: [] as Array<{ node: string }> },
      { id: 'connC', nodes: [{ node: 'n1' }] },
    ]
    expect(pruneEmptyConnections(clusters, s).map(c => c.id)).toEqual(['connB', 'connC'])
  })

  it('is a no-op for a null scope', () => {
    const clusters = [{ id: 'connA', nodes: [] }]
    expect(pruneEmptyConnections(clusters, null)).toEqual(clusters)
  })
})

describe('tokenInfraScope', () => {
  it('is never guest-derived', () => {
    expect(tokenInfraScope(['connA'])!.guestDerived).toBe(false)
    expect(tokenInfraScope(null)).toBeNull()
  })
})
