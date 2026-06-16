import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { authOptions } from "@/lib/auth/config"
import {
  resolveSharedTaskScope,
  sharedTaskWindowWhere,
  jobPassesSharedTaskScope,
  toSharedTask,
} from "@/lib/tasks/sharedTask"

export const runtime = "nodejs"

/**
 * GET /api/v1/tasks/shared
 * Tenant-scoped list of in-flight / recently-finished external migrations,
 * for the shared ProxCenter Tasks footer. DEFAULT tenant sees the whole fleet.
 */
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.TASKS_VIEW)
    if (denied) return denied

    const session = await getServerSession(authOptions)
    const myId = (session as any)?.user?.id ?? null

    const scope = await resolveSharedTaskScope()
    if (!scope.isDefault && scope.reachableConnectionIds.size === 0) {
      return NextResponse.json({ data: [] })
    }

    const cutoff = new Date(Date.now() - 30 * 60 * 1000)
    const jobs = await scope.client.migrationJob.findMany({
      where: {
        ...sharedTaskWindowWhere(cutoff),
        ...(scope.isDefault
          ? {}
          : { targetConnectionId: { in: [...scope.reachableConnectionIds] } }),
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    })

    const reachable = jobs.filter((j: any) => jobPassesSharedTaskScope(j, scope))

    const creatorIds = [...new Set(reachable.map((j: any) => j.createdBy).filter(Boolean))] as string[]
    const users = creatorIds.length
      ? await scope.client.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true, email: true } })
      : []
    const nameById = new Map<string, string>(users.map((u: any) => [u.id, u.name || u.email || "Unknown"]))

    const data = reachable.map((j: any) =>
      toSharedTask(j, {
        isMine: !!myId && j.createdBy === myId,
        createdByName: j.createdBy ? (nameById.get(j.createdBy) ?? "Unknown") : "Unknown",
      }),
    )

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
