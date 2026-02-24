// GET /api/v1/compliance/hardening/[connectionId]
import { NextResponse } from 'next/server'

import { pveFetch } from '@/lib/proxmox/client'
import { getConnectionById } from '@/lib/connections/getConnection'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { runAllChecks, computeScore, type HardeningData } from '@/lib/compliance/hardening'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VM_BATCH_LIMIT = 50

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ connectionId: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE)
    if (denied) return denied

    const { connectionId } = await ctx.params
    const conn = await getConnectionById(connectionId)

    // Parallel fetch: cluster-level data
    const [firewallOptions, version, nodesRaw, usersRaw, resourcesRaw] = await Promise.all([
      pveFetch<any>(conn, '/cluster/firewall/options').catch(() => ({})),
      pveFetch<any>(conn, '/version').catch(() => ({})),
      pveFetch<any>(conn, '/nodes').catch(() => []),
      pveFetch<any>(conn, '/access/users?full=1').catch(() => []),
      pveFetch<any>(conn, '/cluster/resources').catch(() => []),
    ])

    const nodes: Array<{ node: string; status?: string }> = Array.isArray(nodesRaw) ? nodesRaw : []
    const users = Array.isArray(usersRaw) ? usersRaw : []
    const resources = Array.isArray(resourcesRaw) ? resourcesRaw : []

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

    // VM firewall checks (batch limited)
    const vms = resources.filter((r: any) => r.type === 'qemu' || r.type === 'lxc').slice(0, VM_BATCH_LIMIT)
    const vmFirewalls: Record<string, any> = {}
    const vmSecurityGroups: Record<string, boolean> = {}

    await Promise.all(vms.map(async (vm: any) => {
      const key = `${vm.node}/${vm.type}/${vm.vmid}`
      const nodeName = encodeURIComponent(vm.node)
      const vmType = vm.type === 'lxc' ? 'lxc' : 'qemu'
      const vmid = vm.vmid

      try {
        const fwOpts = await pveFetch<any>(conn, `/nodes/${nodeName}/${vmType}/${vmid}/firewall/options`)
        vmFirewalls[key] = fwOpts || {}
      } catch {
        vmFirewalls[key] = {}
      }

      try {
        const rules = await pveFetch<any>(conn, `/nodes/${nodeName}/${vmType}/${vmid}/firewall/rules`)
        const rulesList = Array.isArray(rules) ? rules : []
        vmSecurityGroups[key] = rulesList.some((r: any) => r.type === 'group')
      } catch {
        vmSecurityGroups[key] = false
      }
    }))

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
    }

    const checks = runAllChecks(hardeningData)
    const summary = computeScore(checks)

    return NextResponse.json({
      connectionId,
      connectionName: conn.name,
      score: summary.score,
      checks,
      summary,
      scannedAt: new Date().toISOString(),
    })
  } catch (e: any) {
    console.error('Error running hardening checks:', e)
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
