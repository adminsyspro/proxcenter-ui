import { createPbsJobConfig, type PbsJobCollectionContext } from "@/lib/proxmox/pbsJobConfig"
import { SYNC_JOB } from "@/lib/proxmox/pbsJobSpecs"

export const runtime = "nodejs"

/**
 * POST /api/v1/pbs/[id]/jobs/sync
 * Crée un nouveau Sync Job sur PBS
 */
export async function POST(req: Request, ctx: PbsJobCollectionContext) {
  return createPbsJobConfig(req, ctx, SYNC_JOB)
}
