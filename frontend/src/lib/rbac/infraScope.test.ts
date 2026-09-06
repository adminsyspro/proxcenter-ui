// frontend/src/lib/rbac/infraScope.test.ts
import { describe, it, expect } from 'vitest'
import { deriveRbacInfraScope, isConnectionVisible, applyRbacInfraFilter, filterVisibleConnections, mayHaveVisibleGuests, filterCandidateConnections, pruneEmptyConnections, tokenInfraScope, isFlatRecordVisible, hasInfraGrant, type RbacInfraScope } from './infraScope'

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

describe('isFlatRecordVisible (flat feeds, issue #525)', () => {
  const scope = (over: Partial<RbacInfraScope> = {}): RbacInfraScope => ({
    fullConnections: new Set<string>(),
    nodesByConnection: new Map<string, Set<string>>(),
    guestDerived: false,
    ...over,
  })
  const nodeScope = () => scope({ nodesByConnection: new Map([['connA', new Set(['n1'])]]) })
  const connScope = () => scope({ fullConnections: new Set(['connA']) })

  it('null scope keeps every row, connection-less rows included', () => {
    expect(isFlatRecordVisible(null, { connId: 'connA', node: 'n9' })).toBe(true)
    expect(isFlatRecordVisible(null, {})).toBe(true)
  })

  it('a row with no connection never reaches a scoped user', () => {
    expect(isFlatRecordVisible(connScope(), { node: 'n1' })).toBe(false)
    expect(isFlatRecordVisible(nodeScope(), { connId: '', node: 'n1' })).toBe(false)
    expect(isFlatRecordVisible(scope({ guestDerived: true }), { node: 'n1' })).toBe(false)
  })

  it('connection grant keeps every row of that connection, node named or not, and drops other connections', () => {
    expect(isFlatRecordVisible(connScope(), { connId: 'connA', node: 'n7' })).toBe(true)
    expect(isFlatRecordVisible(connScope(), { connId: 'connA' })).toBe(true)
    expect(isFlatRecordVisible(connScope(), { connId: 'connB', node: 'n1' })).toBe(false)
  })

  it('node scope keeps a row on a granted node and drops a row on another node', () => {
    expect(isFlatRecordVisible(nodeScope(), { connId: 'connA', node: 'n1' })).toBe(true)
    expect(isFlatRecordVisible(nodeScope(), { connId: 'connA', node: 'n2' })).toBe(false)
  })

  it('node scope drops a node-bound row that names no node (the default)', () => {
    expect(isFlatRecordVisible(nodeScope(), { connId: 'connA' })).toBe(false)
    expect(isFlatRecordVisible(nodeScope(), { connId: 'connA', node: null, nodeBound: true })).toBe(false)
  })

  it('node scope keeps a cluster-level row of the granted connection', () => {
    expect(isFlatRecordVisible(nodeScope(), { connId: 'connA', nodeBound: false })).toBe(true)
  })

  it('node scope drops every row of a connection without a grant, cluster-level ones included', () => {
    expect(isFlatRecordVisible(nodeScope(), { connId: 'connB', node: 'n1' })).toBe(false)
    expect(isFlatRecordVisible(nodeScope(), { connId: 'connB', nodeBound: false })).toBe(false)
  })

  it('guest-derived scope keeps every connection-bound row: only the per-guest filter can decide', () => {
    const s = scope({ guestDerived: true, nodesByConnection: new Map([['connA', new Set(['n1'])]]) })
    expect(isFlatRecordVisible(s, { connId: 'connA', node: 'n2' })).toBe(true)
    expect(isFlatRecordVisible(s, { connId: 'connB' })).toBe(true)
  })
})

describe('deriveRbacInfraScope: permission-aware derivation and vm grants (issue #525)', () => {
  const grant = (scopeType: string, scopeTarget: string | null, ...permissions: string[]) =>
    ({ scopeType, scopeTarget, permissions: new Set(permissions) })

  it('without a permission every grant counts (the #524 tree semantics)', () => {
    const s = deriveRbacInfraScope({ superAdmin: false, byScope: [grant('node', 'c1:n1', 'alerts.manage'), grant('connection', 'c2', 'vm.view')] })!
    expect([...s.fullConnections]).toEqual(['c2'])
    expect([...s.nodesByConnection.keys()]).toEqual(['c1'])
  })

  it('with a permission only the grants carrying it shape the perimeter', () => {
    const grants = {
      superAdmin: false,
      byScope: [grant('node', 'c1:n1', 'alerts.manage', 'connection.view'), grant('connection', 'c2', 'vm.view', 'connection.view')],
    }
    const manage = deriveRbacInfraScope(grants, 'alerts.manage')!
    expect(manage.fullConnections.size).toBe(0)
    expect([...manage.nodesByConnection.keys()]).toEqual(['c1'])
    const view = deriveRbacInfraScope(grants, 'connection.view')!
    expect([...view.fullConnections]).toEqual(['c2'])
    expect([...view.nodesByConnection.keys()]).toEqual(['c1'])
  })

  it('a list of permissions matches a grant carrying any of them', () => {
    const grants = {
      superAdmin: false,
      byScope: [grant('node', 'c1:n1', 'node.view'), grant('vm', 'c2:n2:qemu:200', 'vm.view'), grant('connection', 'c3', 'backup.view')],
    }
    const s = deriveRbacInfraScope(grants, ['vm.view', 'node.view'])!
    expect([...s.nodesByConnection.keys()].sort()).toEqual(['c1', 'c2'])
    expect(s.fullConnections.has('c3')).toBe(false)
  })

  it('only a global grant OF the permission makes the user unrestricted', () => {
    const grants = { superAdmin: false, byScope: [grant('global', null, 'backup.view'), grant('node', 'c1:n1', 'connection.view')] }
    expect(deriveRbacInfraScope(grants)).toBeNull()
    expect(deriveRbacInfraScope(grants, 'backup.view')).toBeNull()
    const s = deriveRbacInfraScope(grants, 'connection.view')!
    expect([...s.nodesByConnection.get('c1')!]).toEqual(['n1'])
  })

  it('a grant without a permission set is ignored under a permission filter, kept without one', () => {
    const grants = { superAdmin: false, byScope: [{ scopeType: 'connection', scopeTarget: 'c1' }] }
    expect(deriveRbacInfraScope(grants)!.fullConnections.has('c1')).toBe(true)
    expect(deriveRbacInfraScope(grants, 'vm.view')!.fullConnections.size).toBe(0)
  })

  it('a node grant is outright, a vm grant only lends its node to the tree and keeps the VMID', () => {
    const s = deriveRbacInfraScope({ superAdmin: false, byScope: [grant('node', 'c1:n1', 'vm.view'), grant('vm', 'c1:n2:qemu:200', 'vm.view')] })!
    expect([...s.nodesByConnection.get('c1')!].sort()).toEqual(['n1', 'n2'])
    expect([...s.nodeGrantsByConnection!.get('c1')!]).toEqual(['n1'])
    expect([...s.guestGrantsByConnection!.get('c1')!]).toEqual(['200'])
  })

  it('a token scope carries empty node and guest grant maps', () => {
    const s = tokenInfraScope(['a'])!
    expect(s.nodeGrantsByConnection!.size).toBe(0)
    expect(s.guestGrantsByConnection!.size).toBe(0)
  })
})

describe('isFlatRecordVisible with vm grants, and hasInfraGrant (issue #525)', () => {
  const derived = (...byScope: Array<{ scopeType: string; scopeTarget: string | null }>) =>
    deriveRbacInfraScope({ superAdmin: false, byScope })!
  const vmOnly = () => derived({ scopeType: 'vm', scopeTarget: 'c1:n1:qemu:100' })
  const mixed = () => derived({ scopeType: 'node', scopeTarget: 'c1:n1' }, { scopeType: 'vm', scopeTarget: 'c1:n2:qemu:200' })

  it('vm grant: only rows naming that VMID pass, wherever the guest runs now', () => {
    expect(isFlatRecordVisible(vmOnly(), { connId: 'c1', node: 'n1', vmid: '100' })).toBe(true)
    expect(isFlatRecordVisible(vmOnly(), { connId: 'c1', node: 'n3', vmid: 100 })).toBe(true)
    expect(isFlatRecordVisible(vmOnly(), { connId: 'c1', node: 'n1', vmid: '101' })).toBe(false)
    expect(isFlatRecordVisible(vmOnly(), { connId: 'c1', vmid: '101' })).toBe(false)
  })

  it('vm grant: node-level and cluster-level rows of the host are denied', () => {
    expect(isFlatRecordVisible(vmOnly(), { connId: 'c1', node: 'n1' })).toBe(false)
    expect(isFlatRecordVisible(vmOnly(), { connId: 'c1', nodeBound: false })).toBe(false)
    expect(isFlatRecordVisible(vmOnly(), { connId: 'c1' })).toBe(false)
  })

  it('node grant still covers every guest of the node; a vm grant adds its own guest elsewhere', () => {
    expect(isFlatRecordVisible(mixed(), { connId: 'c1', node: 'n1', vmid: '999' })).toBe(true)
    expect(isFlatRecordVisible(mixed(), { connId: 'c1', node: 'n2', vmid: '200' })).toBe(true)
    expect(isFlatRecordVisible(mixed(), { connId: 'c1', node: 'n2', vmid: '201' })).toBe(false)
    expect(isFlatRecordVisible(mixed(), { connId: 'c1', node: 'n2' })).toBe(false)
    expect(isFlatRecordVisible(mixed(), { connId: 'c1', nodeBound: false })).toBe(true)
  })

  it('a hand-built scope without nodeGrantsByConnection treats every listed node as an outright grant', () => {
    const legacy: RbacInfraScope = { fullConnections: new Set(), nodesByConnection: new Map([['c1', new Set(['n1'])]]), guestDerived: false }
    expect(isFlatRecordVisible(legacy, { connId: 'c1', node: 'n1', vmid: '5' })).toBe(true)
    expect(isFlatRecordVisible(legacy, { connId: 'c1', nodeBound: false })).toBe(true)
    expect(hasInfraGrant(legacy, 'c1')).toBe(true)
  })

  it('hasInfraGrant: admin, connection and node grants yes; vm-only and tag / pool no', () => {
    expect(hasInfraGrant(null, 'c1')).toBe(true)
    expect(hasInfraGrant(derived({ scopeType: 'connection', scopeTarget: 'c1' }), 'c1')).toBe(true)
    expect(hasInfraGrant(mixed(), 'c1')).toBe(true)
    expect(hasInfraGrant(vmOnly(), 'c1')).toBe(false)
    expect(hasInfraGrant(mixed(), 'c2')).toBe(false)
    expect(hasInfraGrant(derived({ scopeType: 'tag', scopeTarget: 'prod' }), 'c1')).toBe(false)
  })
})
