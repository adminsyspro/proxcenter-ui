import { NextResponse } from "next/server"

import { prisma as globalPrisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { migrateScope, scopedJobWhere } from "@/lib/migration/authorize"
import { getCurrentTenantId, getSessionPrisma } from "@/lib/tenant"
import { getTenantInfrastructureScope, inventoryConnectionPlan } from "@/lib/tenant/infraScope"
import { aggregateMigrationStats, type MigrationStatsRow } from "@/lib/migration/migration-stats"

export const runtime = "nodejs"

/**
 * GET /api/v1/migrations/stats
 * Completed / failed / in progress and the bytes moved, over every migration
 * of the caller's tenant (the session client scopes the jobs), from the source
 * connections the inventory shows it (same client choice as the inventory).
 */
export async function GET() {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
    if (denied) return denied

    const tenantId = await getCurrentTenantId()
    const plan = inventoryConnectionPlan(await getTenantInfrastructureScope(tenantId))
    const connClient: any = plan.pbsExtClient === "global" ? globalPrisma : prisma
    const sources: Array<{ id: string; type: string }> = await connClient.connection.findMany({
      where: { type: { notIn: ["pve", "pbs"] } },
      select: { id: true, type: true },
    })
    if (sources.length === 0) return NextResponse.json({ data: { bySource: {}, byType: {} } })

    const rows = await prisma.migrationJob.groupBy({
      by: ["sourceConnectionId", "status"],
      where: scopedJobWhere({ sourceConnectionId: { in: sources.map(s => s.id) } }, await migrateScope()),
      _count: { _all: true },
      _sum: { bytesTransferred: true },
    })
    return NextResponse.json({ data: aggregateMigrationStats(rows as unknown as MigrationStatsRow[], new Map(sources.map(s => [s.id, s.type]))) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
