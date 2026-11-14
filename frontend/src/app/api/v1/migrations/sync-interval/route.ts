import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { connectionSyncIntervalSec } from "@/lib/migration/warm/sync-interval-source"

export const runtime = "nodejs"

/**
 * GET /api/v1/migrations/sync-interval?sourceConnectionId=...
 * The interval between two syncs a warm migration from this source starts
 * with: the setting of the source connection, one minute without one. Read
 * with the right to migrate, because the operator who launches a migration
 * does not always hold the right to open the connection in Settings, and
 * would otherwise be shown one minute whatever the real setting.
 */
export async function GET(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
    if (denied) return denied
    const sourceConnectionId = new URL(req.url).searchParams.get("sourceConnectionId")
    if (!sourceConnectionId) return NextResponse.json({ error: "sourceConnectionId is required" }, { status: 400 })
    const prisma = await getSessionPrisma()
    return NextResponse.json({ data: { defaultSyncIntervalSec: await connectionSyncIntervalSec(sourceConnectionId, prisma as any) } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
