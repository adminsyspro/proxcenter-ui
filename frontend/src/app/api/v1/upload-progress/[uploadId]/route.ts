export const dynamic = "force-dynamic"
import { NextResponse } from "next/server"
import { getProgress } from "@/lib/upload-progress"

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ uploadId: string }> }
) {
  const { uploadId } = await ctx.params
  const progress = getProgress(uploadId)

  if (!progress) {
    return NextResponse.json({ bytesSent: 0, totalBytes: 0, status: "unknown" })
  }

  return NextResponse.json(progress)
}
