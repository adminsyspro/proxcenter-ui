export const dynamic = "force-dynamic"
import { NextResponse } from "next/server"
import { getPrincipal, rejectionToResponse } from "@/lib/auth/principal"
import { getProgress } from "@/lib/upload-progress"

/**
 * GET /api/v1/upload-progress/{uploadId}
 *
 * Scoped to the caller who opened the upload rather than to a permission
 * (#699): the counters belong to one transfer of one user, and no role in the
 * model says "may watch someone else's upload". An id that is not the caller's
 * gets the same answer as an id that never existed.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ uploadId: string }> }
) {
  const { uploadId } = await ctx.params

  const result = await getPrincipal()

  if (!result.ok) return rejectionToResponse(result.rejection)

  const userId = result.principal?.userId

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const progress = getProgress(uploadId, userId)

  if (!progress) {
    return NextResponse.json({ bytesSent: 0, totalBytes: 0, status: "unknown" })
  }

  return NextResponse.json(progress)
}
