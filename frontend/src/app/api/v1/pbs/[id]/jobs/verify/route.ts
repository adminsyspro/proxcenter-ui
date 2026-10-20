import { createPbsJobConfig, type PbsJobCollectionContext } from "@/lib/proxmox/pbsJobConfig"
import { VERIFY_JOB } from "@/lib/proxmox/pbsJobSpecs"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

/**
 * POST /api/v1/pbs/[id]/jobs/verify
 * Crée un nouveau Verify Job sur PBS
 */
async function handler(req: Request, ctx: PbsJobCollectionContext) {
  return createPbsJobConfig(req, ctx, VERIFY_JOB)
}

export const POST = withAudit({ category: "backups", resourceType: "pbs", resourceParam: "id" }, withPublicApiGuard("pbs-job-verify-create", handler))
