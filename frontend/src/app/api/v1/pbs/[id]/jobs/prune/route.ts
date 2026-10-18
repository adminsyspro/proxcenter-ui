import { createPbsJobConfig, type PbsJobCollectionContext } from "@/lib/proxmox/pbsJobConfig"
import { PRUNE_JOB } from "@/lib/proxmox/pbsJobSpecs"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"

export const runtime = "nodejs"

/**
 * POST /api/v1/pbs/[id]/jobs/prune
 * Crée un nouveau Prune Job sur PBS
 */
async function handler(req: Request, ctx: PbsJobCollectionContext) {
  return createPbsJobConfig(req, ctx, PRUNE_JOB)
}

export const POST = withPublicApiGuard("pbs-job-prune-create", handler)
