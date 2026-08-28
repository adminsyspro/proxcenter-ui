import { createPbsJobConfig, type PbsJobCollectionContext } from "@/lib/proxmox/pbsJobConfig"
import { VERIFY_JOB } from "@/lib/proxmox/pbsJobSpecs"

export const runtime = "nodejs"

/**
 * POST /api/v1/pbs/[id]/jobs/verify
 * Crée un nouveau Verify Job sur PBS
 */
export async function POST(req: Request, ctx: PbsJobCollectionContext) {
  return createPbsJobConfig(req, ctx, VERIFY_JOB)
}
