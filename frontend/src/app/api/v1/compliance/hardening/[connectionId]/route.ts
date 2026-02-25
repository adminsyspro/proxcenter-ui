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
import { getFrameworkById } from '@/lib/compliance/frameworks'
import { getProfile, getProfileChecks, getActiveProfile } from '@/lib/compliance/profiles'

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
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE)
    if (denied) return denied

    const { connectionId } = await ctx.params
    const conn = await getConnectionById(connectionId)

    const { searchParams } = new URL(req.url)
    const frameworkId = searchParams.get('frameworkId')
    const profileId = searchParams.get('profileId')

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

    // VM firewall checks (all VMs, concurrency-controlled)
    const vms = resources.filter((r: any) => r.type === 'qemu' || r.type === 'lxc')
    const vmFirewalls: Record<string, any> = {}
    const vmSecurityGroups: Record<string, boolean> = {}

    await runWithConcurrency(vms, VM_CONCURRENCY, async (vm: any) => {
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
    })

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

    // Determine check config: profileId > frameworkId > active profile > all checks
    let checkConfig: CheckConfig[] | null = null
    let activeFrameworkId: string | null = null
    let activeProfileId: string | null = null

    if (profileId) {
      const profile = getProfile(profileId)
      if (profile) {
        const profileChecks = getProfileChecks(profileId)
        checkConfig = profileChecks.map(pc => ({
          checkId: pc.check_id,
          enabled: pc.enabled === 1,
          weight: pc.weight,
          controlRef: pc.control_ref || undefined,
          category: pc.category || undefined,
        }))
        activeProfileId = profileId
        activeFrameworkId = profile.framework_id
      }
    } else if (frameworkId) {
      const fw = getFrameworkById(frameworkId)
      if (fw) {
        checkConfig = fw.checks.map(c => ({
          checkId: c.checkId,
          enabled: true,
          weight: c.weight,
          controlRef: c.controlRef,
          category: c.category,
        }))
        activeFrameworkId = frameworkId
      }
    } else {
      // Check for active profile
      const active = getActiveProfile(connectionId)
      if (active) {
        checkConfig = active.checks.map(pc => ({
          checkId: pc.check_id,
          enabled: pc.enabled === 1,
          weight: pc.weight,
          controlRef: pc.control_ref || undefined,
          category: pc.category || undefined,
        }))
        activeProfileId = active.id
        activeFrameworkId = active.framework_id
      }
    }

    // Run checks
    if (checkConfig) {
      const weightedChecks = runChecksWithProfile(hardeningData, checkConfig)
      const summary = computeWeightedScore(weightedChecks)

      return NextResponse.json({
        connectionId,
        connectionName: conn.name,
        score: summary.score,
        checks: weightedChecks,
        summary,
        frameworkId: activeFrameworkId,
        profileId: activeProfileId,
        scannedAt: new Date().toISOString(),
      })
    }

    // Default: all 13 checks, no weighting
    const checks = runAllChecks(hardeningData)
    const summary = computeScore(checks)

    return NextResponse.json({
      connectionId,
      connectionName: conn.name,
      score: summary.score,
      checks,
      summary,
      frameworkId: null,
      profileId: null,
      scannedAt: new Date().toISOString(),
    })
  } catch (e: any) {
    console.error('Error running hardening checks:', e)
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
