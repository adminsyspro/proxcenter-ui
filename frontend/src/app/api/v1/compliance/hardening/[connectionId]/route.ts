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
import { applyRiskAcceptances, listRiskAcceptances } from '@/lib/compliance/riskAcceptance'
import { getCurrentTenantId, verifyConnectionOwnership } from '@/lib/tenant'
import { demoResponse } from '@/lib/demo/demo-api'
import { getSessionPrisma } from "@/lib/tenant"
import { getHardeningData } from '@/lib/compliance/collectionCache'
import { denyIaasTenant } from '@/lib/tenant/iaasGuard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  ctx: { params: Promise<{ connectionId: string }> }
) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE)
    if (denied) return denied

    // Reads the whole cluster and audits every node over SSH: not for an
    // IaaS tenant, whose vDC binding would otherwise hand it the provider's
    // connection.
    const iaasDenied = await denyIaasTenant()
    if (iaasDenied) return iaasDenied

    const prisma = await getSessionPrisma()
    const { connectionId } = await ctx.params

    // Verify connection belongs to current tenant
    const ownershipError = await verifyConnectionOwnership(connectionId)
    if (ownershipError) return ownershipError

    const conn = await getConnectionById(connectionId)

    const { searchParams } = new URL(req.url)
    const profileId = searchParams.get('profileId')
    const nodeFilter = searchParams.get('node') // If set, only check this specific node
    // The scan button asks for a fresh collection; every other read may reuse
    // the one the other compliance screens just made (lib/compliance/collectionCache).
    const forceRefresh = searchParams.get('refresh') === '1'

    // Look up SSH setting for this connection
    const connectionRecord = await prisma.connection.findUnique({
      where: { id: connectionId },
      select: { sshEnabled: true },
    })

    const tenantId = await getCurrentTenantId()

    const collection = await getHardeningData({
      tenantId,
      connectionId,
      conn,
      nodeFilter,
      sshEnabled: !!connectionRecord?.sshEnabled,
      forceRefresh,
    })
    const hardeningData: HardeningData = collection.data
    const scannedAt = collection.collectedAt.toISOString()

    const sshAvailable = hardeningData.sshData ? hardeningData.sshData.nodes.filter(n => n.available).length : 0
    const sshTotal = hardeningData.sshData ? hardeningData.sshData.nodes.length : 0

    // Determine check config: explicit profileId > active profile > all checks
    let checkConfig: CheckConfig[] | null = null
    let activeProfileId: string | null = null

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

    // Risks accepted on this connection: the failing checks they cover read
    // 'accepted' and leave the score, for the cluster view and a node's alike.
    const acceptances = await listRiskAcceptances(tenantId, connectionId)

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
      const weightedChecks = applyRiskAcceptances(filterForNode(runChecksWithProfile(hardeningData, filteredConfig)), acceptances)
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
        scannedAt,
      })
    }

    // Default: all checks (PVE + SSH), no weighting
    const checks = applyRiskAcceptances(filterForNode(runAllChecks(hardeningData)), acceptances)
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
      scannedAt,
    })
  } catch (e: any) {
    console.error('Error running hardening checks:', e)
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
