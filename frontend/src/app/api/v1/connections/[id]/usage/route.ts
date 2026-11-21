import { NextResponse } from "next/server"

import { connectionUsage } from "@/lib/connections/connectionUsage"
import { prisma as globalPrisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId, getSessionPrisma } from "@/lib/tenant"
import { denyIaasTenant } from "@/lib/tenant/iaasGuard"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"

export const runtime = "nodejs"

/**
 * GET /api/v1/connections/[id]/usage: what still uses the connection, read by
 * the delete dialog when it opens so the operator sees every link before
 * clicking (ui#1394). DELETE enforces the same check.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  // A connection's links are the whole cluster's business: an IaaS tenant,
  // which reaches the cluster only through its vDC, gets 404 (roadmap#189).
  const iaasDenied = await denyIaasTenant()
  if (iaasDenied) return iaasDenied

  try {
    const { id } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)
    if (denied) return denied

    const prisma = await getSessionPrisma()
    const callerTenantId = await getCurrentTenantId()
    const select = { type: true, tenantId: true } as const
    // As DELETE does: the provider also reaches a connection an MSP tenant owns.
    const connection = (await prisma.connection.findUnique({ where: { id }, select }))
      ?? (callerTenantId === DEFAULT_TENANT_ID ? await globalPrisma.connection.findUnique({ where: { id }, select }) : null)
    if (!connection) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json(await connectionUsage(id, connection, { callerTenantId }))
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
