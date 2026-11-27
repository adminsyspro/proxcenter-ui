import { describe, it, expect } from 'vitest'
import { deriveAppSummaries, appHealthRollup, scopeToGroup, isExternalToProxmox } from './appGrid'
import type { K8sTopologyData, K8sTopologyResource } from './topologyTypes'

const R = (p: Partial<K8sTopologyResource>): K8sTopologyResource => ({
  id: p.id ?? 'id', uid: p.uid ?? 'u', kind: p.kind ?? 'deployment', name: p.name ?? 'n',
  groupKey: p.groupKey ?? 'g', healthy: p.healthy ?? true, ...p,
}) as K8sTopologyResource

const DATA = (over: Partial<K8sTopologyData>): K8sTopologyData => ({
  namespaceMode: 'all', namespace: null, groups: [], resources: [], edges: [],
  infra: { bridgeStatus: 'enabled', external: false, hosts: [], k8sNodes: [] },
  meta: { truncated: false, perKind: {}, correlation: {} as any },
  ...over,
})

describe('appHealthRollup', () => {
  it('error when any resource has a failing reason', () => {
    expect(appHealthRollup([R({ healthy: false, reason: 'CrashLoopBackOff' })])).toBe('error')
  })
  it('degraded when some pods unhealthy without failing reason', () => {
    expect(appHealthRollup([R({ kind: 'podGroup', podCount: 3, healthyCount: 1 })])).toBe('degraded')
  })
  it('healthy when everything is healthy', () => {
    expect(appHealthRollup([R({ kind: 'podGroup', podCount: 2, healthyCount: 2 })])).toBe('healthy')
  })
})

describe('deriveAppSummaries', () => {
  it('groups resources and reads label/namespace from groups', () => {
    const data = DATA({
      groups: [{ key: 'ns1/web', label: 'web', namespace: 'ns1', count: 2 }],
      resources: [
        R({ id: 'd1', kind: 'deployment', groupKey: 'ns1/web' }),
        R({ id: 'p1', kind: 'podGroup', groupKey: 'ns1/web', podCount: 3, healthyCount: 3 }),
      ],
    })
    const [app] = deriveAppSummaries(data)
    expect(app.label).toBe('web')
    expect(app.namespace).toBe('ns1')
    expect(app.kindCounts.deployment).toBe(1)
    expect(app.podsTotal).toBe(3)
    expect(app.podsHealthy).toBe(3)
    expect(app.health).toBe('healthy')
  })
})

describe('scopeToGroup', () => {
  it('keeps only the group resources, internal edges, and placed nodes', () => {
    const data = DATA({
      resources: [
        R({ id: 'd1', groupKey: 'A' }),
        R({ id: 'pg1', kind: 'podGroup', groupKey: 'A', nodePlacement: ['w1'] }),
        R({ id: 'd2', groupKey: 'B' }),
      ],
      edges: [
        { source: 'd1', target: 'pg1', rel: 'owns' },
        { source: 'd2', target: 'd1', rel: 'owns' },
      ],
      infra: { bridgeStatus: 'enabled', external: false, hosts: [],
        k8sNodes: [
          { uid: 'w1', id: 'node/w1', name: 'w1', ready: true, version: 'v', hostId: '', detailRef: { kind: 'node', name: 'w1' } },
          { uid: 'w2', id: 'node/w2', name: 'w2', ready: true, version: 'v', hostId: '', detailRef: { kind: 'node', name: 'w2' } },
        ] },
    })
    const scoped = scopeToGroup(data, 'A')
    expect(scoped.resources.map(r => r.id).sort()).toEqual(['d1', 'pg1'])
    expect(scoped.edges).toHaveLength(1) // only d1->pg1
    expect(scoped.infra.k8sNodes.map(n => n.id)).toEqual(['node/w1']) // only the placed node
  })
})

describe('isExternalToProxmox', () => {
  it('returns the DTO external flag', () => {
    expect(isExternalToProxmox(DATA({ infra: { bridgeStatus: 'disabled_no_visibility', external: true, hosts: [], k8sNodes: [] } }))).toBe(true)
    expect(isExternalToProxmox(DATA({}))).toBe(false)
  })
})
