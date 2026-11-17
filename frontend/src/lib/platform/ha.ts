// The Platform status page on a high-availability install: one line per node
// of the control plane, from the orchestrator's own cluster probe (Patroni,
// etcd, `docker ps` and the load of each node over SSH). Read only once the
// cluster is actually converted: a saved but undeployed configuration has no
// node to probe.

import type { HaInfo, HaNode, ServiceState } from './types'

/** GET /ha/config of the orchestrator, the part read here. */
export interface HaConfigAnswer {
  deploymentState?: string
  deployedAt?: string | null
}

/** GET /ha/cluster of the orchestrator, as it answers it. */
export interface HaClusterAnswer {
  patroni?: {
    syncMode?: string
    paused?: boolean
    members?: { name: string; host: string; role?: string; state?: string; lagBytes?: number; version?: string }[]
  }
  etcd?: { members?: { name: string; healthy: boolean }[] }
  vip?: { address?: string; holder?: string }
  services?: Record<string, Record<string, string>>
  hosts?: Record<string, { load1: number; load5: number; load15: number; cpus: number; mem_total_bytes: number; mem_available_bytes: number } | null>
}

/** Services of a node, in the order the page lists them. */
export const HA_SERVICES = ['frontend', 'orchestrator', 'patroni', 'etcd', 'haproxy', 'keepalived', 'weasyprint'] as const

/**
 * A running cluster: deployed, or converted once and its last deploy failed.
 * Same rule as isConvertedCluster in the HA tab, kept here so this server
 * module does not import a client hook file.
 */
export function isClusterConverted(config: HaConfigAnswer | null | undefined): boolean {
  if (!config) return false

  return config.deploymentState === 'deployed' || (config.deploymentState === 'failed' && Boolean(config.deployedAt))
}

/**
 * A node is down when nothing answers on it (every service unknown, or its
 * database unreachable with no service running), degraded when one of its
 * services is not running.
 */
export function nodeState(node: Pick<HaNode, 'services' | 'dbState'>): ServiceState {
  const states = HA_SERVICES.map(name => node.services[name] ?? 'unknown')

  if (states.every(s => s === 'unknown')) return 'down'
  if (states.every(s => s !== 'running')) return 'down'
  if (states.some(s => s !== 'running') || node.dbState === 'unreachable') return 'degraded'

  return 'up'
}

export function toHaInfo(cluster: HaClusterAnswer): HaInfo {
  const etcd = new Map((cluster.etcd?.members ?? []).map(m => [m.name, m.healthy]))
  const holder = cluster.vip?.holder ?? ''

  const nodes: HaNode[] = (cluster.patroni?.members ?? []).map(member => {
    const host = cluster.hosts?.[member.name] ?? null
    const node = {
      name: member.name,
      address: member.host,
      dbRole: member.role || null,
      dbState: member.state || null,
      lagBytes: member.lagBytes ?? 0,
      version: member.version || null,
      holdsVip: holder !== '' && holder === member.name,
      etcdHealthy: etcd.get(member.name) ?? false,
      services: cluster.services?.[member.name] ?? {},
      host: host && {
        load1: host.load1,
        load5: host.load5,
        load15: host.load15,
        cpus: host.cpus,
        memTotalBytes: host.mem_total_bytes,
        memAvailableBytes: host.mem_available_bytes
      }
    }

    return { ...node, state: nodeState(node) }
  })

  return {
    vip: cluster.vip?.address ?? '',
    syncMode: cluster.patroni?.syncMode ?? '',
    paused: cluster.patroni?.paused ?? false,
    hasLeader: nodes.some(n => n.dbRole === 'leader'),
    nodes
  }
}

/**
 * What the cluster adds to the overall state: down without a database
 * leader, degraded as soon as a node is not fully up.
 */
export function haOverall(ha: HaInfo): ServiceState {
  if (!ha.hasLeader) return 'down'

  return ha.nodes.some(n => n.state !== 'up') ? 'degraded' : 'up'
}
