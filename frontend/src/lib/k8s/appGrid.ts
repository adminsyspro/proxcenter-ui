import type { K8sTopologyData, K8sTopologyResource, K8sTopologyGroup } from './topologyTypes'

export type AppHealth = 'healthy' | 'degraded' | 'error'

export interface AppSummary {
  key: string
  label: string
  namespace?: string
  shared?: boolean
  health: AppHealth
  podsHealthy: number
  podsTotal: number
  kindCounts: Record<string, number>
}

// Reasons the backend already emits for hard pod failures. Keep in sync with
// FAILING_REASONS in server/topologyWorkload.ts; do not invent new strings.
const FAILING_REASONS = new Set([
  'CrashLoopBackOff', 'ImagePullBackOff', 'OOMKilled', 'Error', 'Failed',
])

export function appHealthRollup(resources: K8sTopologyResource[]): AppHealth {
  const hasHardFailure = resources.some(r => r.reason && FAILING_REASONS.has(r.reason))
  if (hasHardFailure) return 'error'
  const anyUnhealthy = resources.some(r => {
    if (typeof r.podCount === 'number' && typeof r.healthyCount === 'number') {
      return r.healthyCount < r.podCount
    }
    return r.healthy === false
  })
  return anyUnhealthy ? 'degraded' : 'healthy'
}

export function deriveAppSummaries(data: K8sTopologyData): AppSummary[] {
  const byGroup = new Map<string, K8sTopologyResource[]>()
  for (const r of data.resources) {
    const list = byGroup.get(r.groupKey) ?? []
    list.push(r)
    byGroup.set(r.groupKey, list)
  }
  const groupByKey = new Map<string, K8sTopologyGroup>(data.groups.map(g => [g.key, g]))

  const out: AppSummary[] = []
  for (const [key, resources] of byGroup) {
    const g = groupByKey.get(key)
    const kindCounts: Record<string, number> = {}
    let podsHealthy = 0
    let podsTotal = 0
    for (const r of resources) {
      kindCounts[r.kind] = (kindCounts[r.kind] ?? 0) + 1
      if (typeof r.podCount === 'number') {
        podsTotal += r.podCount
        podsHealthy += r.healthyCount ?? 0
      }
    }
    out.push({
      key,
      label: g?.label ?? key,
      namespace: g?.namespace,
      ...(g?.shared ? { shared: true } : {}),
      health: appHealthRollup(resources),
      podsHealthy,
      podsTotal,
      kindCounts,
    })
  }
  // Stable ordering: unhealthy first, then by label.
  const rank: Record<AppHealth, number> = { error: 0, degraded: 1, healthy: 2 }
  out.sort((a, b) => rank[a.health] - rank[b.health] || a.label.localeCompare(b.label))
  return out
}

export function scopeToGroup(data: K8sTopologyData, groupKey: string): K8sTopologyData {
  const resources = data.resources.filter(r => r.groupKey === groupKey)
  const ids = new Set(resources.map(r => r.id))
  const edges = data.edges.filter(e => ids.has(e.source) && ids.has(e.target))
  const placedNodeIds = new Set<string>()
  for (const r of resources) {
    for (const nid of r.nodePlacement ?? []) placedNodeIds.add(nid)
  }
  const k8sNodes = data.infra.k8sNodes.filter(n => placedNodeIds.has(n.name))
  const hostIds = new Set(k8sNodes.map(n => n.hostId))
  const hosts = data.infra.hosts.filter(h => hostIds.has(h.id))
  return {
    ...data,
    resources,
    edges,
    groups: data.groups.filter(g => g.key === groupKey),
    infra: { ...data.infra, hosts, k8sNodes },
  }
}

export function isExternalToProxmox(data: K8sTopologyData): boolean {
  return data.infra.external
}
