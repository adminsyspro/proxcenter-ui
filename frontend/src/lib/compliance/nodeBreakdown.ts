// src/lib/compliance/nodeBreakdown.ts
// Pure in-memory slicing: re-runs runAllChecks for each node in the cluster
// using only that node's subset of HardeningData, then strips cluster-wide checks.
// Does NOT modify hardening.ts, ssh-checks.ts, or runAllChecks.

import { runAllChecks, type HardeningData, type HardeningCheck } from './hardening'

export interface NodeCheckResult {
  id: string
  name: string
  category: string
  severity: string
  status: string
  details?: string
}

export interface NodeBreakdown {
  node: string
  checks: NodeCheckResult[]
}

/**
 * For each node in data.nodes, build a node-scoped slice of HardeningData and
 * run runAllChecks on it. The result includes only non-cluster checks so the
 * caller can display per-node findings alongside the aggregate framework view.
 *
 * Rationale: 'cluster' category checks (datacenter firewall, version, backup,
 * HA, replication, pools) are datacenter-wide and not per-node, so they are
 * excluded here. All other categories (node/ssh/os/network/services/filesystem/
 * logging/vm and access) are kept; genuinely per-node ones (SSH/OS) vary by
 * node, and the few datacenter-scoped access checks repeat harmlessly.
 */
export function computeNodeBreakdown(data: HardeningData): NodeBreakdown[] {
  const nodes = data.nodes ?? []

  return nodes.map(n => {
    const nodeSlice: HardeningData = {
      // Node-specific fields: only this node
      nodes: [n],
      nodeDetails: data.nodeDetails
        ? { [n.node]: data.nodeDetails[n.node] }
        : undefined,
      sshData: data.sshData
        ? { nodes: data.sshData.nodes.filter(x => x.node === n.node) }
        : undefined,
      resources: data.resources?.filter(r => r.node === n.node),
      vmFirewalls: data.vmFirewalls
        ? filterByNodePrefix(data.vmFirewalls, n.node)
        : undefined,
      vmSecurityGroups: data.vmSecurityGroups
        ? filterByNodePrefix(data.vmSecurityGroups, n.node)
        : undefined,
      vmConfigs: data.vmConfigs
        ? filterByNodePrefix(data.vmConfigs, n.node)
        : undefined,
      // Cluster-level fields: kept as-is (datacenter-wide)
      firewallOptions: data.firewallOptions,
      version: data.version,
      users: data.users,
      tfa: data.tfa,
      backupJobs: data.backupJobs,
      haResources: data.haResources,
      replicationJobs: data.replicationJobs,
      pools: data.pools,
    }

    const checks = runAllChecks(nodeSlice)

    return {
      node: n.node,
      checks: checks
        .filter((c: HardeningCheck) => c.category !== 'cluster')
        .map((c: HardeningCheck) => ({
          id: c.id,
          name: c.name,
          category: c.category,
          severity: c.severity,
          status: c.status,
          details: c.details,
        })),
    }
  })
}

// Keep only keys that start with `${nodeName}/`
function filterByNodePrefix<T>(record: Record<string, T>, nodeName: string): Record<string, T> {
  const prefix = `${nodeName}/`
  const result: Record<string, T> = {}
  for (const key of Object.keys(record)) {
    if (key.startsWith(prefix)) {
      result[key] = record[key]
    }
  }
  return result
}
