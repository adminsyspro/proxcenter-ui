import {
  deletePbsJobConfig,
  updatePbsJobConfig,
  type PbsJobRouteContext,
} from "@/lib/proxmox/pbsJobConfig"
import { PRUNE_JOB } from "@/lib/proxmox/pbsJobSpecs"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

/**
 * PUT /api/v1/pbs/[id]/jobs/prune/[jobId]
 * Met à jour un Prune Job
 */
async function putHandler(req: Request, ctx: PbsJobRouteContext) {
  return updatePbsJobConfig(req, ctx, PRUNE_JOB)
}

/**
 * DELETE /api/v1/pbs/[id]/jobs/prune/[jobId]
 * Supprime un Prune Job
 */
async function deleteHandler(req: Request, ctx: PbsJobRouteContext) {
  return deletePbsJobConfig(req, ctx, PRUNE_JOB)
}

export const PUT = withAudit({ category: "backups", resourceType: "prune_job", resourceParam: "jobId" }, withPublicApiGuard("pbs-job-prune-update", putHandler))
export const DELETE = withAudit({ category: "backups", resourceType: "prune_job", resourceParam: "jobId" }, withPublicApiGuard("pbs-job-prune-delete", deleteHandler))
