// Guards of a framework report, shared by the synchronous report route and the
// creation of a background report job: same checks, same order, same answers.
import { NextResponse } from 'next/server'

import { getConnectionById } from '@/lib/connections/getConnection'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { requireEnterprise } from '@/lib/auth/requireEnterprise'
import { verifyConnectionOwnership, getSessionPrisma, getCurrentTenantId } from '@/lib/tenant'
import { denyIaasTenant } from '@/lib/tenant/iaasGuard'
import { FRAMEWORKS } from '@/lib/compliance/frameworks'
import type { FrameworkId } from '@/lib/compliance/frameworks/types'

export type ReportRequest =
  | { ok: false; response: Response }
  | {
      ok: true
      frameworkId: FrameworkId
      connectionId: string
      conn: any
      sshEnabled: boolean
      tenantId: string
    }

export async function resolveReportRequest(
  frameworkId: string | null | undefined,
  connectionId: string | null | undefined,
): Promise<ReportRequest> {
  const refuse = (response: Response): ReportRequest => ({ ok: false, response })

  // Guard: connectionId required (cheap presence check first)
  if (!connectionId) return refuse(NextResponse.json({ error: 'connectionId required' }, { status: 400 }))

  // Guard 1: Enterprise-only feature (before exposing framework ID validity to non-enterprise callers)
  const entGuard = await requireEnterprise()
  if (entGuard) return refuse(entGuard)

  // Guard: known frameworkId (after enterprise check to avoid info leak)
  if (!frameworkId || !FRAMEWORKS.some(f => f.id === frameworkId)) {
    return refuse(NextResponse.json({ error: 'unknown framework' }, { status: 400 }))
  }

  // The whole cluster, over SSH too: not for an IaaS tenant, whose vDC
  // binding would otherwise hand it the provider's connection.
  const iaasDenied = await denyIaasTenant()
  if (iaasDenied) return refuse(iaasDenied)

  // Guard 2: Tenant ownership
  const ownershipError = await verifyConnectionOwnership(connectionId)
  if (ownershipError) return refuse(ownershipError)

  // Guard 3: RBAC
  const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE, 'connection', connectionId)
  if (denied) return refuse(denied)

  const conn = await getConnectionById(connectionId)
  if (!conn) return refuse(NextResponse.json({ error: 'connection not found' }, { status: 404 }))

  const prisma = await getSessionPrisma()
  const connectionRecord = await prisma.connection.findUnique({
    where: { id: connectionId },
    select: { sshEnabled: true },
  })

  return {
    ok: true,
    frameworkId: frameworkId as FrameworkId,
    connectionId,
    conn,
    sshEnabled: !!connectionRecord?.sshEnabled,
    tenantId: await getCurrentTenantId(),
  }
}
