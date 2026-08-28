import { createPbsJobConfig, type PbsJobCollectionContext } from "@/lib/proxmox/pbsJobConfig"
import { PRUNE_JOB } from "@/lib/proxmox/pbsJobSpecs"

export const runtime = "nodejs"

/**
 * POST /api/v1/pbs/[id]/jobs/prune
 * Crée un nouveau Prune Job sur PBS
 */
export async function POST(req: Request, ctx: PbsJobCollectionContext) {
  return createPbsJobConfig(req, ctx, PRUNE_JOB)
}
