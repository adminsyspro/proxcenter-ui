import {
  deletePbsJobConfig,
  updatePbsJobConfig,
  type PbsJobRouteContext,
} from "@/lib/proxmox/pbsJobConfig"
import { SYNC_JOB } from "@/lib/proxmox/pbsJobSpecs"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

/**
 * PUT /api/v1/pbs/[id]/jobs/sync/[jobId]
 * Met à jour un Sync Job
 */
async function putHandler(req: Request, ctx: PbsJobRouteContext) {
  return updatePbsJobConfig(req, ctx, SYNC_JOB)
}

/**
 * DELETE /api/v1/pbs/[id]/jobs/sync/[jobId]
 * Supprime un Sync Job
 */
async function deleteHandler(req: Request, ctx: PbsJobRouteContext) {
  return deletePbsJobConfig(req, ctx, SYNC_JOB)
}

export const PUT = withAudit({ category: "backups", resourceType: "sync_job", resourceParam: "jobId" }, withPublicApiGuard("pbs-job-sync-update", putHandler))
export const DELETE = withAudit({ category: "backups", resourceType: "sync_job", resourceParam: "jobId" }, withPublicApiGuard("pbs-job-sync-delete", deleteHandler))
