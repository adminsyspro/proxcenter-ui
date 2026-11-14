import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { migrateScope, scopedJobWhere } from "@/lib/migration/authorize"
import { parseCutoverMeasure, parseSyncInterval } from "@/lib/migration/warm/sync-interval"
import { connectionSyncIntervalSec } from "@/lib/migration/warm/sync-interval-source"
import {
  SYNC_INTERVAL_JOB_ERROR, SYNC_INTERVAL_VALUE_ERROR, canSetSyncInterval, jobConfigOf, readRequestedSyncInterval, setJobSyncInterval,
} from "@/lib/migration/warm/set-sync-interval"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

/** The job, for a caller allowed to migrate between its two ends; a Response otherwise. */
async function loadJob(id: string) {
  const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
  if (denied) return { denied }
  const prisma = await getSessionPrisma()
  const job = await prisma.migrationJob.findFirst({ where: scopedJobWhere({ id }, await migrateScope()) })
  if (!job) return { denied: NextResponse.json({ error: "Migration job not found" }, { status: 404 }) }
  return { prisma, job }
}

/**
 * GET /api/v1/migrations/[id]/sync-interval
 * The interval a waiting warm migration syncs at: its own or the setting of
 * its source connection, with the one the engine suggests from the syncs it
 * measured and the measure a cutover is estimated from. Read with the right to migrate, so an operator who cannot open
 * the source connection in Settings still sees the value that applies.
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params
    const found = await loadJob(id)
    if (found.denied) return found.denied
    const { prisma, job } = found
    const own = parseSyncInterval(jobConfigOf(job).syncIntervalSec)
    const defaultSyncIntervalSec = await connectionSyncIntervalSec(job.sourceConnectionId, prisma as any)
    return NextResponse.json({
      data: {
        syncIntervalSec: own || defaultSyncIntervalSec,
        overridden: typeof own === "number",
        defaultSyncIntervalSec,
        suggestedSyncIntervalSec: job.suggestedSyncIntervalSec ?? null,
        measure: parseCutoverMeasure(job.syncMeasure),
        editable: canSetSyncInterval(job),
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * PATCH /api/v1/migrations/[id]/sync-interval
 * `{ syncIntervalSec: number | null }`: change the interval of a migration
 * that waits for its manual cutover, or put it back on the setting of the
 * source connection. The engine picks the change up while the job sleeps.
 */
async function handlePatch(req: Request, { params }: Params) {
  try {
    const { id } = await params
    const found = await loadJob(id)
    if (found.denied) return found.denied
    const { prisma, job } = found
    const requested = readRequestedSyncInterval(await req.json().catch(() => null))
    if (requested === undefined) return NextResponse.json({ error: SYNC_INTERVAL_VALUE_ERROR }, { status: 400 })
    if (!canSetSyncInterval(job)) return NextResponse.json({ error: SYNC_INTERVAL_JOB_ERROR }, { status: 400 })

    await setJobSyncInterval(prisma, job, requested)
    const syncIntervalSec = requested ?? await connectionSyncIntervalSec(job.sourceConnectionId, prisma as any)
    return NextResponse.json({ data: { syncIntervalSec, overridden: requested !== null } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const PATCH = withAudit({ category: "migration", resourceType: "migration", resourceParam: "id", action: "update" }, handlePatch)
