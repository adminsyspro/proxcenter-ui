// GET /api/v1/compliance/frameworks?connectionId=
// Returns a FrameworkAssessment for each registered compliance framework,
// scored against the raw (unfiltered) hardening checks for the connection.
import { NextResponse } from 'next/server'

import { getConnectionById } from '@/lib/connections/getConnection'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { requireEnterprise } from '@/lib/auth/requireEnterprise'
import { verifyConnectionOwnership, getSessionPrisma } from '@/lib/tenant'
import { collectHardeningData } from '@/lib/compliance/collectHardeningData'
import { runAllChecks } from '@/lib/compliance/hardening'
import { FRAMEWORKS, getCrosswalk } from '@/lib/compliance/frameworks'
import { assessFramework } from '@/lib/compliance/frameworkAssessment'
import { computeNodeBreakdown } from '@/lib/compliance/nodeBreakdown'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const connectionId = searchParams.get('connectionId')
    if (!connectionId) {
      return NextResponse.json({ error: 'connectionId required' }, { status: 400 })
    }

    // Guard 1: Enterprise-only feature
    const entGuard = await requireEnterprise()
    if (entGuard) return entGuard

    // Guard 2: Tenant ownership (matches hardening route pattern)
    const ownershipError = await verifyConnectionOwnership(connectionId)
    if (ownershipError) return ownershipError

    // Guard 3: RBAC
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE, 'connection', connectionId)
    if (denied) return denied

    // Resolve connection
    const conn = await getConnectionById(connectionId)
    if (!conn) {
      return NextResponse.json({ error: 'connection not found' }, { status: 404 })
    }

    // Look up SSH setting (mirrors hardening route lines 45-48)
    const prisma = await getSessionPrisma()
    const connectionRecord = await prisma.connection.findUnique({
      where: { id: connectionId },
      select: { sshEnabled: true },
    })

    // Collect raw data (mirrors hardening route lines 50-55)
    const hardeningData = await collectHardeningData({
      connectionId,
      conn,
      sshEnabled: !!connectionRecord?.sshEnabled,
    })

    // Run ALL checks (no profile, no weighting) and assess against each framework
    const checks = runAllChecks(hardeningData)
    const assessments = FRAMEWORKS.map(def => assessFramework(checks, def, getCrosswalk(def.id)))

    // Per-node breakdown: re-run checks for each node using a node-scoped slice
    const nodes = computeNodeBreakdown(hardeningData)

    return NextResponse.json({ data: assessments, nodes })
  } catch (e: any) {
    console.error('Error running framework assessments:', e?.message)
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
