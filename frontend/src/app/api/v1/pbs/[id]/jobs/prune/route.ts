import { createPbsJobConfig, type PbsJobCollectionContext } from "@/lib/proxmox/pbsJobConfig"
import { PRUNE_JOB } from "@/lib/proxmox/pbsJobSpecs"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

/**
 * POST /api/v1/pbs/[id]/jobs/prune
 * Crée un nouveau Prune Job sur PBS
 */
async function handler(req: Request, ctx: PbsJobCollectionContext) {
  return createPbsJobConfig(req, ctx, PRUNE_JOB)
}

export const POST = withAudit({ category: "backups", resourceType: "pbs", resourceParam: "id" }, withPublicApiGuard("pbs-job-prune-create", handler))
