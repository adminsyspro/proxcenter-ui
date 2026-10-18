import { createPbsJobConfig, type PbsJobCollectionContext } from "@/lib/proxmox/pbsJobConfig"
import { SYNC_JOB } from "@/lib/proxmox/pbsJobSpecs"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"

export const runtime = "nodejs"

/**
 * POST /api/v1/pbs/[id]/jobs/sync
 * Crée un nouveau Sync Job sur PBS
 */
async function handler(req: Request, ctx: PbsJobCollectionContext) {
  return createPbsJobConfig(req, ctx, SYNC_JOB)
}

export const POST = withPublicApiGuard("pbs-job-sync-create", handler)
