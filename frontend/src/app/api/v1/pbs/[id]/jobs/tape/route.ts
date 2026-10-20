import { createPbsJobConfig, type PbsJobCollectionContext } from "@/lib/proxmox/pbsJobConfig"
import { TAPE_JOB } from "@/lib/proxmox/pbsJobSpecs"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

/**
 * POST /api/v1/pbs/[id]/jobs/tape
 * Crée un nouveau Tape Backup Job sur PBS
 */
async function handler(req: Request, ctx: PbsJobCollectionContext) {
  return createPbsJobConfig(req, ctx, TAPE_JOB)
}

export const POST = withAudit({ category: "backups", resourceType: "pbs", resourceParam: "id" }, withPublicApiGuard("pbs-job-tape-create", handler))
