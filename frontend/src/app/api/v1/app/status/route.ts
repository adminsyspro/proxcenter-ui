import { NextResponse } from "next/server"

import { prisma as basePrisma } from "@/lib/db/prisma"
import { getSessionPrisma, getCurrentTenantId } from "@/lib/tenant"

export const runtime = 'nodejs'

/**
 * GET /api/v1/app/status
 * Onboarding state, read by the sign-in page before any session exists: is
 * the first-run setup due, and is at least one connection configured.
 *
 * Public, so it answers with those two decisions and no count
 * (GHSA-5hx5-2429-mg7w): how many accounts or connections an instance holds
 * is not for an unauthenticated caller, and nothing in the interface reads it.
 */
export async function GET() {
  try {
    const prisma = await getSessionPrisma()
    const tenantId = await getCurrentTenantId()

    // Cross-tenant on purpose: the setup wizard is due only while NO user
    // exists, whichever tenant they belong to.
    const userCount = await basePrisma.user.count()

    // Connections of the tenant, direct or through an enabled vDC.
    const connectionCount = await prisma.connection.count()
    const vdcCount = await basePrisma.vdc.count({ where: { tenantId, enabled: true } })

    return NextResponse.json({
      setupRequired: userCount === 0,
      connectionsConfigured: connectionCount > 0 || vdcCount > 0,
    })
  } catch (error) {
    console.error("Error checking app status:", error)

    return NextResponse.json({
      setupRequired: true,
      connectionsConfigured: false,
    })
  }
}
