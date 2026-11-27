import { describe, it, expect } from 'vitest'
import { buildK8sTopologyGraph, INFRA_GAP } from './buildK8sTopologyGraph'
import type { K8sTopologyData } from './topologyTypes'

function baseData(): K8sTopologyData {
  return {
    namespaceMode: 'single',
    namespace: 'default',
    groups: [
      { key: 'app-a', label: 'App A', count: 1 },
    ],
    resources: [
      {
        id: 'res-1',
        uid: 'uid-1',
        kind: 'deployment',
        name: 'frontend',
        groupKey: 'app-a',
        healthy: true,
      },
    ],
    edges: [],
    infra: {
      bridgeStatus: 'disabled_no_visibility',
      external: false,
      hosts: [],
      k8sNodes: [],
    },
    meta: {
      truncated: false,
      perKind: {},
      correlation: {
        bridgeStatus: 'disabled_no_visibility',
        attempted: 0,
        matched: 0,
        byKey: {},
        unmapped: 0,
        ambiguous: 0,
        skippedOutOfScope: 0,
        vmScanCapped: false,
        configFetchFailed: 0,
      },
    },
  }
}

function fixtureWithPlacement(): K8sTopologyData {
  return {
    namespaceMode: 'single',
    namespace: 'default',
    groups: [
      { key: 'app-b', label: 'App B', count: 1 },
    ],
    resources: [
      {
        id: 'pg-1',
        uid: 'uid-pg-1',
        kind: 'podGroup',
        name: 'frontend-pods',
        groupKey: 'app-b',
        healthy: true,
        nodePlacement: ['node-1'],
      },
    ],
    edges: [],
    infra: {
      bridgeStatus: 'enabled',
      external: false,
      hosts: [
        { id: 'host-1', hostName: 'pve-1' },
      ],
      k8sNodes: [
        {
          uid: 'k8snode-uid-1',
          id: 'k8snode-1',
          name: 'node-1',
          ready: true,
          version: 'v1.30.0',
          hostId: 'host-1',
          detailRef: { kind: 'Node', name: 'node-1' },
        },
      ],
    },
    meta: {
      truncated: false,
      perKind: {},
      correlation: {
        bridgeStatus: 'enabled',
        attempted: 1,
        matched: 1,
        byKey: {},
        unmapped: 0,
        ambiguous: 0,
        skippedOutOfScope: 0,
        vmScanCapped: false,
        configFetchFailed: 0,
      },
    },
  }
}

function fixtureWithInfra(): K8sTopologyData {
  return {
    namespaceMode: 'single',
    namespace: 'default',
    groups: [
      { key: 'app-c', label: 'App C', count: 1 },
    ],
    resources: [
      {
        id: 'res-c',
        uid: 'uid-c',
        kind: 'deployment',
        name: 'backend',
        groupKey: 'app-c',
        healthy: true,
      },
    ],
    edges: [],
    infra: {
      bridgeStatus: 'enabled',
      external: false,
      hosts: [
        { id: 'host-2', hostName: 'pve-2' },
      ],
      k8sNodes: [
        {
          uid: 'k8snode-uid-2',
          id: 'k8snode-2',
          name: 'node-2',
          ready: true,
          version: 'v1.30.0',
          hostId: 'host-2',
          detailRef: { kind: 'Node', name: 'node-2' },
        },
      ],
    },
    meta: {
      truncated: false,
      perKind: {},
      correlation: {
        bridgeStatus: 'enabled',
        attempted: 1,
        matched: 1,
        byKey: {},
        unmapped: 0,
        ambiguous: 0,
        skippedOutOfScope: 0,
        vmScanCapped: false,
        configFetchFailed: 0,
      },
    },
  }
}

describe('buildK8sTopologyGraph', () => {
  it('emits one appGroup parent per group with children parented', () => {
    const { nodes } = buildK8sTopologyGraph(baseData())
    const group = nodes.find((n) => n.type === 'appGroup')
    expect(group).toBeTruthy()
    expect(group!.id).toBe('appGroup-app-a')
    // child res-1 should have parentId pointing to the group
    const child = nodes.find((n) => n.id === 'res-1')
    expect(child).toBeTruthy()
    expect(child!.parentId).toBe('appGroup-app-a')
    expect(child!.extent).toBe('parent')
  })

  it('placement edges are hidden by default and carry data.kind === placement', () => {
    const { edges } = buildK8sTopologyGraph(fixtureWithPlacement())
    const placementEdges = edges.filter((e) => (e.data as any)?.kind === 'placement')
    expect(placementEdges.length).toBeGreaterThan(0)
    expect(placementEdges.every((e) => e.hidden === true)).toBe(true)
  })

  it('bridgeStatus not enabled produces no proxmoxHost or k8sNode nodes', () => {
    const { nodes } = buildK8sTopologyGraph(baseData())
    expect(nodes.some((n) => n.type === 'proxmoxHost' || n.type === 'k8sNode')).toBe(false)
  })

  it('crossGroup DTO edge yields an edge with data.crossGroup === true', () => {
    const d = baseData()
    // Add a second group and resource to create a cross-group edge
    d.groups.push({ key: 'app-d', label: 'App D', count: 1 })
    d.resources.push({
      id: 'res-d',
      uid: 'uid-d',
      kind: 'service',
      name: 'svc',
      groupKey: 'app-d',
      healthy: true,
    })
    d.edges.push({ source: 'res-1', target: 'res-d', rel: 'routes', crossGroup: true })
    const { edges } = buildK8sTopologyGraph(d)
    const crossEdge = edges.find((e) => e.source === 'res-1' && e.target === 'res-d')
    expect(crossEdge).toBeTruthy()
    expect((crossEdge!.data as any).crossGroup).toBe(true)
  })

  it('infra region is positioned below the workload region when bridge is enabled', () => {
    const { nodes } = buildK8sTopologyGraph(fixtureWithInfra())
    const workloadParent = nodes.find((n) => n.type === 'appGroup')
    const infraParent = nodes.find((n) => n.type === 'proxmoxHost')
    expect(workloadParent).toBeTruthy()
    expect(infraParent).toBeTruthy()
    const workloadBottom = workloadParent!.position.y + ((workloadParent!.data as any).height ?? 0)
    // Infra must start at or after the workload bottom PLUS the explicit gap
    expect(infraParent!.position.y).toBeGreaterThanOrEqual(workloadBottom + INFRA_GAP)
  })

  it('k8sNode child node has extent === parent', () => {
    const { nodes } = buildK8sTopologyGraph(fixtureWithInfra())
    const k8sNode = nodes.find((n) => n.type === 'k8sNode')
    expect(k8sNode).toBeTruthy()
    expect(k8sNode!.extent).toBe('parent')
  })

  it('k8sNode assigned to unmapped host box renders correctly', () => {
    const d = fixtureWithInfra()
    // Add an explicit unmapped host and a k8sNode assigned to it
    d.infra.hosts.push({ id: 'unmapped', hostName: 'Unmapped' })
    d.infra.k8sNodes.push({
      uid: 'k8snode-uid-unmapped',
      id: 'k8snode-unmapped',
      name: 'orphan-node',
      ready: false,
      version: 'v1.30.0',
      hostId: 'unmapped',
      detailRef: { kind: 'Node', name: 'orphan-node' },
    })
    const { nodes } = buildK8sTopologyGraph(d)
    const unmappedHost = nodes.find(
      (n) => n.type === 'proxmoxHost' && (n.id as string).includes('unmapped'),
    )
    expect(unmappedHost).toBeTruthy()
    const unmappedChild = nodes.find((n) => n.id === 'k8snode-unmapped')
    expect(unmappedChild).toBeTruthy()
    expect(unmappedChild!.parentId).toBe(unmappedHost!.id)
  })

  it('k8sNode with a hostId not in data.infra.hosts is placed under a synthesized host box (no node dropped)', () => {
    const d = fixtureWithInfra()
    // Add a k8sNode referencing a hostId that is NOT declared in hosts
    d.infra.k8sNodes.push({
      uid: 'k8snode-uid-ghost',
      id: 'k8snode-ghost',
      name: 'ghost-node',
      ready: false,
      version: 'v1.30.0',
      hostId: 'host-does-not-exist',
      detailRef: { kind: 'Node', name: 'ghost-node' },
    })
    const { nodes } = buildK8sTopologyGraph(d)
    // The ghost k8sNode must still appear (not dropped)
    const ghostNode = nodes.find((n) => n.id === 'k8snode-ghost')
    expect(ghostNode).toBeTruthy()
    // A synthesized proxmoxHost for the missing hostId must exist
    const syntheticHost = nodes.find(
      (n) => n.type === 'proxmoxHost' && (n.id as string).includes('host-does-not-exist'),
    )
    expect(syntheticHost).toBeTruthy()
    expect(ghostNode!.parentId).toBe(syntheticHost!.id)
  })
})
