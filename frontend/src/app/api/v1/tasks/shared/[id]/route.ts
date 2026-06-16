import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { authOptions } from "@/lib/auth/config"
import {
  resolveSharedTaskScope,
  jobInSharedTaskWindow,
  jobPassesSharedTaskScope,
  toSharedTask,
} from "@/lib/tasks/sharedTask"

export const runtime = "nodejs"

/**
 * GET /api/v1/tasks/shared/[id]
 * Read-only detail (incl. logs) for a single shared migration task. Same
 * tenant/DEFAULT scope and recency window as the list.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const denied = await checkPermission(PERMISSIONS.TASKS_VIEW)
    if (denied) return denied

    const session = await getServerSession(authOptions)
    const myId = (session as any)?.user?.id ?? null

    const scope = await resolveSharedTaskScope()
    const { id } = await params
    const job = await scope.client.migrationJob.findUnique({ where: { id } })

    const cutoff = new Date(Date.now() - 30 * 60 * 1000)
    if (!job || !jobPassesSharedTaskScope(job, scope) || !jobInSharedTaskWindow(job, cutoff)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    let createdByName = "Unknown"
    if (job.createdBy) {
      const u = await scope.client.user.findUnique({ where: { id: job.createdBy }, select: { name: true, email: true } })
      createdByName = u?.name || u?.email || "Unknown"
    }

    return NextResponse.json({
      data: {
        ...toSharedTask(job, { isMine: !!myId && job.createdBy === myId, createdByName }),
        logs: job.logs ?? [],
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
