// Gathers all PVE and SSH data that runAllChecks / runChecksWithProfile need.
// No profile logic, no scoring, no HTTP response — pure data collection.

import { pveFetch } from '@/lib/proxmox/client'
import { buildSSHAuditCommand, parseSSHAuditOutput, type SSHNodeData, type SSHHardeningData } from '@/lib/compliance/ssh-checks'
import { executeSSH } from '@/lib/ssh/exec'
import { getNodeIp } from '@/lib/ssh/node-ip'
import type { HardeningData } from '@/lib/compliance/hardening'

const VM_CONCURRENCY = 10

async function runWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    await Promise.all(batch.map(fn))
  }
}

export interface CollectHardeningDataOptions {
  /** Prisma connection record — only `id` and `sshEnabled` are read. */
  connectionId: string
  /** Already-verified PVE connection object passed to pveFetch. */
  conn: any
  /** If set, collect data only for this node name (filters nodes + resources). */
  nodeFilter?: string | null
  /** Whether SSH is enabled for this connection (from prisma.connection.sshEnabled). */
  sshEnabled: boolean
}

/**
 * Fetches all PVE API data and SSH audit results needed by the hardening-check
 * functions. Returns a HardeningData object ready to pass to runAllChecks or
 * runChecksWithProfile. Contains no profile, scoring or response logic.
 */
export async function collectHardeningData(opts: CollectHardeningDataOptions): Promise<HardeningData> {
  const { connectionId, conn, nodeFilter, sshEnabled } = opts

  // Parallel fetch: cluster-level data
  const [firewallOptions, version, nodesRaw, usersRaw, resourcesRaw, backupJobsRaw, haResourcesRaw, replicationRaw, poolsRaw] = await Promise.all([
    pveFetch<any>(conn, '/cluster/firewall/options').catch(() => ({})),
    pveFetch<any>(conn, '/version').catch(() => ({})),
    pveFetch<any>(conn, '/nodes').catch(() => []),
    pveFetch<any>(conn, '/access/users?full=1').catch(() => []),
    pveFetch<any>(conn, '/cluster/resources').catch(() => []),
    pveFetch<any>(conn, '/cluster/backup').catch(() => []),
    pveFetch<any>(conn, '/cluster/ha/resources').catch(() => []),
    pveFetch<any>(conn, '/cluster/replication').catch(() => []),
    pveFetch<any>(conn, '/pools').catch(() => []),
  ])

  const allNodes: Array<{ node: string; status?: string }> = Array.isArray(nodesRaw) ? nodesRaw : []
  // When filtering by node, only keep that specific node
  const nodes = nodeFilter
    ? allNodes.filter(n => n.node === nodeFilter)
    : allNodes
  const users = Array.isArray(usersRaw) ? usersRaw : []
  const allResources = Array.isArray(resourcesRaw) ? resourcesRaw : []
  // When filtering by node, only keep resources on that node
  const resources = nodeFilter
    ? allResources.filter((r: any) => r.node === nodeFilter)
    : allResources
  const backupJobs = Array.isArray(backupJobsRaw) ? backupJobsRaw : []
  const haResources = Array.isArray(haResourcesRaw) ? haResourcesRaw : []
  const replicationJobs = Array.isArray(replicationRaw) ? replicationRaw : []
  const pools = Array.isArray(poolsRaw) ? poolsRaw : []

  // TFA info
  let tfa: any[] = []
  try {
    const tfaRaw = await pveFetch<any>(conn, '/access/tfa')
    tfa = Array.isArray(tfaRaw) ? tfaRaw : []
  } catch {
    // PVE < 7.x may not have this endpoint
  }

  // Per-node details in parallel
  const nodeDetails: Record<string, any> = {}
  await Promise.all(nodes.map(async (n) => {
    const nodeName = encodeURIComponent(n.node)
    const [subscription, aptRepos, certificates, nodeFirewall] = await Promise.all([
      pveFetch<any>(conn, `/nodes/${nodeName}/subscription`).catch(() => ({})),
      pveFetch<any>(conn, `/nodes/${nodeName}/apt/repositories`).catch(() => ({})),
      pveFetch<any>(conn, `/nodes/${nodeName}/certificates/info`).catch(() => []),
      pveFetch<any>(conn, `/nodes/${nodeName}/firewall/options`).catch(() => ({})),
    ])
    nodeDetails[n.node] = { subscription, aptRepos, certificates: Array.isArray(certificates) ? certificates : [], firewall: nodeFirewall }
  }))

  // SSH-based CIS checks: run in parallel with VM data gathering
  let sshData: SSHHardeningData | undefined
  const sshPromise = (async () => {
    try {
      if (!sshEnabled) return

      const sshCommand = buildSSHAuditCommand()
      const sshNodes: SSHNodeData[] = []

      // Only SSH into the filtered node(s)
      await Promise.all(nodes.map(async (n: any) => {
        try {
          const nodeIp = await getNodeIp(conn, n.node)
          const result = await executeSSH(connectionId, nodeIp, sshCommand)
          if (result.success && result.output) {
            sshNodes.push({
              node: n.node,
              available: true,
              sections: parseSSHAuditOutput(result.output),
            })
          } else {
            sshNodes.push({ node: n.node, available: false, sections: {}, error: result.error })
          }
        } catch (e: any) {
          sshNodes.push({ node: n.node, available: false, sections: {}, error: e.message })
        }
      }))

      if (sshNodes.length > 0) {
        sshData = { nodes: sshNodes }
      }
    } catch (e: any) {
      console.warn('[compliance] SSH audit failed:', e.message)
    }
  })()

  // VM data: firewall + config (only VMs in scope, concurrency-controlled)
  const vms = resources.filter((r: any) => r.type === 'qemu' || r.type === 'lxc')
  const vmFirewalls: Record<string, any> = {}
  const vmSecurityGroups: Record<string, boolean> = {}
  const vmConfigs: Record<string, Record<string, any>> = {}

  await runWithConcurrency(vms, VM_CONCURRENCY, async (vm: any) => {
    const key = `${vm.node}/${vm.type}/${vm.vmid}`
    const nodeName = encodeURIComponent(vm.node)
    const vmType = vm.type === 'lxc' ? 'lxc' : 'qemu'
    const vmid = vm.vmid

    const [fwOpts, rules, config] = await Promise.all([
      pveFetch<any>(conn, `/nodes/${nodeName}/${vmType}/${vmid}/firewall/options`).catch(() => ({})),
      pveFetch<any>(conn, `/nodes/${nodeName}/${vmType}/${vmid}/firewall/rules`).catch(() => []),
      pveFetch<any>(conn, `/nodes/${nodeName}/${vmType}/${vmid}/config`).catch(() => null),
    ])

    vmFirewalls[key] = fwOpts || {}

    const rulesList = Array.isArray(rules) ? rules : []
    vmSecurityGroups[key] = rulesList.some((r: any) => r.type === 'group')

    if (config) vmConfigs[key] = config
  })

  // Wait for SSH audit to complete
  await sshPromise

  return {
    firewallOptions,
    version,
    nodes,
    nodeDetails,
    users,
    tfa,
    resources,
    vmFirewalls,
    vmSecurityGroups,
    backupJobs,
    haResources,
    replicationJobs,
    pools,
    vmConfigs,
    sshData,
  }
}
