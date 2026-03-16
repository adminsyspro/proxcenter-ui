// GET /api/v1/compliance/hardening/[connectionId]
import { NextResponse } from 'next/server'

import { pveFetch } from '@/lib/proxmox/client'
import { getConnectionById } from '@/lib/connections/getConnection'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import {
  runAllChecks, computeScore,
  runChecksWithProfile, computeWeightedScore,
  type HardeningData, type CheckConfig,
} from '@/lib/compliance/hardening'
import { getProfile, getProfileChecks, getActiveProfile } from '@/lib/compliance/profiles'
import { getCurrentTenantId, verifyConnectionOwnership } from '@/lib/tenant'
import { buildSSHAuditCommand, parseSSHAuditOutput, type SSHNodeData, type SSHHardeningData } from '@/lib/compliance/ssh-checks'
import { executeSSH } from '@/lib/ssh/exec'
import { getNodeIp } from '@/lib/ssh/node-ip'
import { getSessionPrisma } from "@/lib/tenant"

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VM_CONCURRENCY = 10

async function runWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    await Promise.all(batch.map(fn))
  }
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ connectionId: string }> }
) {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE)
    if (denied) return denied

    const { connectionId } = await ctx.params

    // Verify connection belongs to current tenant
    const ownershipError = await verifyConnectionOwnership(connectionId)
    if (ownershipError) return ownershipError

    const conn = await getConnectionById(connectionId)

    const { searchParams } = new URL(req.url)
    const profileId = searchParams.get('profileId')
    const nodeFilter = searchParams.get('node') // If set, only check this specific node

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
        const connection = await prisma.connection.findUnique({
          where: { id: connectionId },
          select: { sshEnabled: true },
        })
        if (!connection?.sshEnabled) return

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

    const sshAvailable = sshData ? sshData.nodes.filter(n => n.available).length : 0
    const sshTotal = sshData ? sshData.nodes.length : 0

    const hardeningData: HardeningData = {
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

    // Determine check config: explicit profileId > active profile > all checks
    let checkConfig: CheckConfig[] | null = null
    let activeProfileId: string | null = null

    const tenantId = await getCurrentTenantId()

    if (profileId) {
      const profile = getProfile(profileId, tenantId)
      if (profile) {
        const profileChecks = getProfileChecks(profileId, tenantId)
        checkConfig = profileChecks.map(pc => ({
          checkId: pc.check_id,
          enabled: pc.enabled === 1,
          weight: pc.weight,
          controlRef: pc.control_ref || undefined,
          category: pc.category || undefined,
        }))
        activeProfileId = profileId
      }
    } else {
      // Check for active profile
      const active = getActiveProfile(connectionId, tenantId)
      if (active) {
        checkConfig = active.checks.map(pc => ({
          checkId: pc.check_id,
          enabled: pc.enabled === 1,
          weight: pc.weight,
          controlRef: pc.control_ref || undefined,
          category: pc.category || undefined,
        }))
        activeProfileId = active.id
      }
    }

    // Categories to keep when filtering by node (exclude cluster-wide and access checks)
    const nodeCategories = ['node', 'vm', 'os', 'ssh', 'network', 'services', 'filesystem', 'logging']
    const filterForNode = (checks: any[]) =>
      nodeFilter ? checks.filter((c: any) => nodeCategories.includes(c.category)) : checks

    // Run checks
    if (checkConfig) {
      // When filtering by node, exclude cluster/access check configs too
      const filteredConfig = nodeFilter
        ? checkConfig.filter(c => !c.category || nodeCategories.includes(c.category))
        : checkConfig
      const weightedChecks = filterForNode(runChecksWithProfile(hardeningData, filteredConfig))
      const summary = computeWeightedScore(weightedChecks)

      return NextResponse.json({
        connectionId,
        connectionName: conn.name,
        node: nodeFilter || null,
        score: summary.score,
        checks: weightedChecks,
        summary,
        profileId: activeProfileId,
        sshStatus: { available: sshAvailable, total: sshTotal, enabled: !!sshData },
        scannedAt: new Date().toISOString(),
      })
    }

    // Default: all checks (PVE + SSH), no weighting
    const checks = filterForNode(runAllChecks(hardeningData))
    const summary = computeScore(checks)

    return NextResponse.json({
      connectionId,
      connectionName: conn.name,
      node: nodeFilter || null,
      score: summary.score,
      checks,
      summary,
      profileId: null,
      sshStatus: { available: sshAvailable, total: sshTotal, enabled: !!sshData },
      scannedAt: new Date().toISOString(),
    })
  } catch (e: any) {
    console.error('Error running hardening checks:', e)
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
