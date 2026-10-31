/**
 * Guards the tool perimeter.
 *
 * Tool arguments are written by the model, which is steered by user text, so
 * they are untrusted input. The resolvers here are the only sanctioned way for
 * a tool to turn a caller-supplied cluster, host or guest reference into
 * something it may query, and they resolve exclusively against the
 * RBAC-filtered snapshot. If one of them ever starts accepting a reference that
 * is absent from the snapshot, a scoped user could read another tenant's or
 * another pool's infrastructure by asking the assistant nicely, so these tests
 * matter more than their size suggests.
 */

import { describe, it, expect } from 'vitest'

import type { SnapshotGuest, SnapshotNode, InventorySnapshot } from '@/lib/tools/snapshot'

import {
  argEnum,
  argPresentationEnum,
  ToolArgumentError,
  argNumber,
  argString,
  resolveConnection,
  resolveGuest,
  resolveNode,
  ToolScopeError,
  visibleConnections,
  type ToolContext,
} from './types'

function node(overrides: Partial<SnapshotNode> & { name: string; connId: string }): SnapshotNode {
  return {
    cluster: 'prod',
    status: 'online',
    cpuPct: 10,
    memPct: 50,
    memUsedGb: 32,
    memTotalGb: 64,
    ...overrides,
  }
}

function guest(overrides: Partial<SnapshotGuest> & { name: string; vmid: string; connId: string }): SnapshotGuest {
  return {
    cluster: 'prod',
    type: 'VM',
    kind: 'qemu',
    status: 'running',
    node: 'pve1',
    cpuPct: 5,
    memPct: 40,
    memUsedGb: 2,
    memTotalGb: 4,
    template: false,
    ...overrides,
  }
}

function snapshot(overrides: Partial<InventorySnapshot> = {}): InventorySnapshot {
  return {
    clusters: [{ id: 'conn-1', name: 'prod', nodeCount: 2, guestCount: 2 }],
    nodes: [node({ name: 'pve1', connId: 'conn-1' }), node({ name: 'pve2', connId: 'conn-1' })],
    guests: [
      guest({ name: 'db-01', vmid: '101', connId: 'conn-1' }),
      guest({ name: 'web-01', vmid: '102', connId: 'conn-1' }),
    ],
    summary: { totalGuests: 2, runningGuests: 2, stoppedGuests: 0, totalNodes: 2, onlineNodes: 2 },
    cached: false,
    ...overrides,
  }
}

function ctx(snap: InventorySnapshot = snapshot()): ToolContext {
  return { snapshot: snap, tenantId: 'tenant-1', locale: 'en' }
}

describe('argument coercion', () => {
  it('treats the strings models emit for an absent value as absent', () => {
    // A 7B model routinely fills an optional field with the word "null".
    for (const raw of [undefined, null, '', '   ', 'null', 'undefined']) {
      expect(argString({ cluster: raw }, 'cluster')).toBeUndefined()
    }
  })

  it('trims a supplied string', () => {
    expect(argString({ cluster: '  prod ' }, 'cluster')).toBe('prod')
  })

  it('accepts a number sent as a string and clamps it to the allowed range', () => {
    expect(argNumber({ limit: '5' }, 'limit', 10)).toBe(5)
    expect(argNumber({ limit: 5 }, 'limit', 10)).toBe(5)
    expect(argNumber({ limit: '9999' }, 'limit', 10, { max: 50 })).toBe(50)
    expect(argNumber({ limit: '0' }, 'limit', 10, { min: 1 })).toBe(1)
  })

  it('falls back rather than propagating a value it cannot read as a number', () => {
    expect(argNumber({ limit: 'lots' }, 'limit', 10)).toBe(10)
    expect(argNumber({}, 'limit', 10)).toBe(10)
  })

  it('accepts an enum value in any case and defaults only when it is absent', () => {
    const allowed = ['vcpus', 'memory', 'disk'] as const

    expect(argEnum({ metric: 'MEMORY' }, 'metric', allowed, 'vcpus')).toBe('memory')
    expect(argEnum({}, 'metric', allowed, 'vcpus')).toBe('vcpus')
    expect(argEnum({ metric: null }, 'metric', allowed, 'vcpus')).toBe('vcpus')
  })

  it('rejects an enum value outside the allowed set, naming the accepted ones', () => {
    const allowed = ['vcpus', 'memory', 'disk'] as const

    // Falling back silently returned the vCPU ranking to a model that asked
    // for metric="cpu", which it then reported as CPU usage.
    expect(() => argEnum({ metric: 'gpu' }, 'metric', allowed, 'vcpus')).toThrow(ToolArgumentError)
    expect(() => argEnum({ metric: 'gpu' }, 'metric', allowed, 'vcpus')).toThrow('Accepted values: vcpus, memory, disk')
  })
})

describe('resolveConnection', () => {
  it('names the argument to pass when several clusters are visible', () => {
    const ctx: ToolContext = {
      snapshot: { ...snapshot(), clusters: [{ id: 'a', name: 'prod', nodeCount: 1, guestCount: 0 }, { id: 'b', name: 'lab', nodeCount: 1, guestCount: 0 }] },
      tenantId: 't', locale: 'en',
    }

    // "Name one of" sent llama3.1:8b into an invented `clusterName` key.
    expect(() => resolveConnection(ctx)).toThrow('pass the "cluster" argument with one of: prod, lab')
  })

  it('uses the only visible cluster when the model named none', () => {
    expect(resolveConnection(ctx()).id).toBe('conn-1')
  })

  it('accepts either the display name or the connection id', () => {
    expect(resolveConnection(ctx(), 'prod').id).toBe('conn-1')
    expect(resolveConnection(ctx(), 'conn-1').id).toBe('conn-1')
    expect(resolveConnection(ctx(), 'PROD').id).toBe('conn-1')
  })

  it('asks the model to disambiguate when several clusters are visible', () => {
    const snap = snapshot({
      clusters: [
        { id: 'conn-1', name: 'prod', nodeCount: 1, guestCount: 0 },
        { id: 'conn-2', name: 'dr', nodeCount: 1, guestCount: 0 },
      ],
    })

    expect(() => resolveConnection(ctx(snap))).toThrow(ToolScopeError)
    expect(() => resolveConnection(ctx(snap))).toThrow(/prod, dr/)
  })

  it('refuses a cluster absent from the snapshot', () => {
    // The snapshot is already RBAC-filtered, so "absent" means "not visible to
    // this caller" and must be indistinguishable from "does not exist".
    expect(() => resolveConnection(ctx(), 'other-tenant-cluster')).toThrow(ToolScopeError)
  })

  it('does not leak the name of a cluster the caller cannot see', () => {
    try {
      resolveConnection(ctx(), 'secret-cluster')
      throw new Error('should have thrown')
    } catch (e: any) {
      expect(e.message).toContain('prod')
      expect(e.message).not.toContain('conn-2')
    }
  })

  it('reports that nothing is visible rather than picking a default', () => {
    expect(() => resolveConnection(ctx(snapshot({ clusters: [] })))).toThrow(/No cluster is visible/)
  })
})

describe('resolveNode', () => {
  it('resolves a host of a visible cluster', () => {
    const { connection, node: hit } = resolveNode(ctx(), 'pve2')

    expect(connection.id).toBe('conn-1')
    expect(hit.name).toBe('pve2')
  })

  it('refuses a host absent from the snapshot even when the cluster is visible', () => {
    // A node pruned by the caller's infra scope must behave like a typo.
    expect(() => resolveNode(ctx(), 'pve9')).toThrow(ToolScopeError)
    expect(() => resolveNode(ctx(), 'pve9')).toThrow(/Visible hosts: pve1, pve2/)
  })

  it('refuses a host that exists but belongs to another connection', () => {
    const snap = snapshot({
      clusters: [
        { id: 'conn-1', name: 'prod', nodeCount: 1, guestCount: 0 },
        { id: 'conn-2', name: 'dr', nodeCount: 1, guestCount: 0 },
      ],
      nodes: [node({ name: 'pve1', connId: 'conn-1' }), node({ name: 'dr1', connId: 'conn-2', cluster: 'dr' })],
    })

    expect(() => resolveNode(ctx(snap), 'dr1', 'prod')).toThrow(ToolScopeError)
    expect(resolveNode(ctx(snap), 'dr1', 'dr').node.name).toBe('dr1')
  })

  it('uses the only host of a single-host cluster when the model named none', () => {
    const snap = snapshot({ nodes: [node({ name: 'pve1', connId: 'conn-1' })] })

    expect(resolveNode(ctx(snap), undefined).node.name).toBe('pve1')
  })

  it('asks for a host name when the cluster has several', () => {
    expect(() => resolveNode(ctx(), undefined)).toThrow(/pve1, pve2/)
  })

  describe('across several visible clusters, without a cluster argument', () => {
    const twoClusters = () => snapshot({
      clusters: [
        { id: 'conn-1', name: 'prod', nodeCount: 2, guestCount: 0 },
        { id: 'conn-2', name: 'dr', nodeCount: 2, guestCount: 0 },
      ],
      nodes: [
        node({ name: 'pve1', connId: 'conn-1' }),
        node({ name: 'shared-name', connId: 'conn-1' }),
        node({ name: 'pve1-dr', connId: 'conn-2', cluster: 'dr' }),
        node({ name: 'shared-name', connId: 'conn-2', cluster: 'dr' }),
      ],
    })

    it('finds a host name that only one cluster has', () => {
      // The lab: PVE-PROD and PVE-DR both visible, "pve1" only in PVE-PROD.
      const { connection, node: hit } = resolveNode(ctx(twoClusters()), 'PVE1-DR')

      expect(connection).toEqual({ id: 'conn-2', name: 'dr' })
      expect(hit.name).toBe('pve1-dr')
    })

    it('asks for the cluster when two clusters have a host of that name', () => {
      expect(() => resolveNode(ctx(twoClusters()), 'shared-name')).toThrow('pass the "cluster" argument with one of: prod, dr')
    })

    it('refuses an unknown host, listing every visible one', () => {
      expect(() => resolveNode(ctx(twoClusters()), 'pve9')).toThrow('Unknown host "pve9". Visible hosts: pve1, shared-name, pve1-dr, shared-name.')
    })
  })
})

describe('resolveGuest', () => {
  it('resolves by vmid', () => {
    expect(resolveGuest(ctx(), '101').name).toBe('db-01')
  })

  it('resolves by exact name, case-insensitively', () => {
    expect(resolveGuest(ctx(), 'DB-01').vmid).toBe('101')
  })

  it('resolves a unique substring, because users describe a guest loosely', () => {
    expect(resolveGuest(ctx(), 'db').vmid).toBe('101')
  })

  it('refuses an ambiguous substring instead of guessing', () => {
    const snap = snapshot({
      guests: [
        guest({ name: 'db-01', vmid: '101', connId: 'conn-1' }),
        guest({ name: 'db-02', vmid: '102', connId: 'conn-1' }),
      ],
    })

    expect(() => resolveGuest(ctx(snap), 'db')).toThrow(/matches several guests/)
  })

  it('asks for the vmid when two clusters hold the same guest name', () => {
    const snap = snapshot({
      guests: [
        guest({ name: 'db-01', vmid: '101', connId: 'conn-1' }),
        guest({ name: 'db-01', vmid: '201', connId: 'conn-2', cluster: 'dr' }),
      ],
    })

    expect(() => resolveGuest(ctx(snap), 'db-01')).toThrow(/Use the vmid/)
  })

  it('prefers an exact name over a substring match', () => {
    const snap = snapshot({
      guests: [
        guest({ name: 'db', vmid: '101', connId: 'conn-1' }),
        guest({ name: 'db-backup', vmid: '102', connId: 'conn-1' }),
      ],
    })

    expect(resolveGuest(ctx(snap), 'db').vmid).toBe('101')
  })

  it('refuses a guest absent from the snapshot', () => {
    expect(() => resolveGuest(ctx(), '999')).toThrow(ToolScopeError)
    expect(() => resolveGuest(ctx(), 'not-mine')).toThrow(/is visible to you/)
  })

  it('refuses an empty reference rather than defaulting to the first guest', () => {
    expect(() => resolveGuest(ctx(), undefined)).toThrow(ToolScopeError)
  })
})

describe('visibleConnections', () => {
  it('lists exactly the clusters the snapshot carries', () => {
    expect(visibleConnections(snapshot())).toEqual([{ id: 'conn-1', name: 'prod' }])
    expect(visibleConnections(snapshot({ clusters: [] }))).toEqual([])
  })
})

describe('argPresentationEnum', () => {
  const allowed = ['latency', 'usage', 'id'] as const

  it('reads an accepted value like argEnum and leaves no note', () => {
    const notes: string[] = []

    expect(argPresentationEnum({ sortBy: 'USAGE' }, 'sortBy', allowed, 'latency', notes)).toBe('usage')
    expect(argPresentationEnum({}, 'sortBy', allowed, 'latency', notes)).toBe('latency')
    expect(notes).toEqual([])
  })

  it('falls back to the default on an unknown value and says so', () => {
    // llama3.1:8b sent sortBy="none" to list_ceph_osds, borrowed from groupBy.
    const notes: string[] = []

    expect(argPresentationEnum({ sortBy: 'none' }, 'sortBy', allowed, 'latency', notes)).toBe('latency')
    expect(notes).toEqual(['sortBy="none" is not accepted (latency, usage, id), used "latency".'])
  })
})
