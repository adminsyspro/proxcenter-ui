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
 *
 * `?history=1` keeps the tenant scope and the tasks.view check but drops the
 * recency window. The window mirrors what the footer lists (in-flight plus
 * recently finished) and is a UI horizon, not a permission: the Task Center
 * lists the full migration history, so opening a job that finished days ago
 * must return its logs instead of a 404.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const denied = await checkPermission(PERMISSIONS.TASKS_VIEW)
    if (denied) return denied

    const session = await getServerSession(authOptions)
    const myId = (session as any)?.user?.id ?? null

    const includeHistory = new URL(req.url).searchParams.get("history") === "1"

    const scope = await resolveSharedTaskScope()
    const { id } = await params
    const job = await scope.client.migrationJob.findUnique({ where: { id } })

    const cutoff = new Date(Date.now() - 30 * 60 * 1000)
    if (!job || !jobPassesSharedTaskScope(job, scope)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    if (!includeHistory && !jobInSharedTaskWindow(job, cutoff)) {
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
