// GET /api/v1/compliance/hardening/[connectionId]
import { NextResponse } from 'next/server'

import { getConnectionById } from '@/lib/connections/getConnection'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import {
  runAllChecks, computeScore,
  runChecksWithProfile, computeWeightedScore,
  type HardeningData, type CheckConfig,
} from '@/lib/compliance/hardening'
import { getProfile, getProfileChecks, getActiveProfile } from '@/lib/compliance/profiles'
import { getCurrentTenantId, verifyConnectionOwnership } from '@/lib/tenant'
import { demoResponse } from '@/lib/demo/demo-api'
import { getSessionPrisma } from "@/lib/tenant"
import { collectHardeningData } from '@/lib/compliance/collectHardeningData'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  ctx: { params: Promise<{ connectionId: string }> }
) {
  const demo = demoResponse(req)
  if (demo) return demo

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

    // Look up SSH setting for this connection
    const connectionRecord = await prisma.connection.findUnique({
      where: { id: connectionId },
      select: { sshEnabled: true },
    })

    const hardeningData: HardeningData = await collectHardeningData({
      connectionId,
      conn,
      nodeFilter,
      sshEnabled: !!connectionRecord?.sshEnabled,
    })

    const sshAvailable = hardeningData.sshData ? hardeningData.sshData.nodes.filter(n => n.available).length : 0
    const sshTotal = hardeningData.sshData ? hardeningData.sshData.nodes.length : 0

    // Determine check config: explicit profileId > active profile > all checks
    let checkConfig: CheckConfig[] | null = null
    let activeProfileId: string | null = null

    const tenantId = await getCurrentTenantId()

    if (profileId) {
      const profile = await getProfile(profileId, tenantId)
      if (profile) {
        const profileChecks = await getProfileChecks(profileId, tenantId)
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
      const active = await getActiveProfile(connectionId, tenantId)
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
        sshStatus: { available: sshAvailable, total: sshTotal, enabled: !!hardeningData.sshData },
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
      sshStatus: { available: sshAvailable, total: sshTotal, enabled: !!hardeningData.sshData },
      scannedAt: new Date().toISOString(),
    })
  } catch (e: any) {
    console.error('Error running hardening checks:', e)
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
