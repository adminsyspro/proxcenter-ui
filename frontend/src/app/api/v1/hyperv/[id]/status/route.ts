import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

/**
 * GET /api/v1/hyperv/[id]/status
 * Check Hyper-V connection status.
 * For v1, we cannot actually ping Hyper-V (no WinRM client),
 * so we just confirm the connection record exists.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const prisma = await getSessionPrisma()
    const { id } = await params
    const conn = await prisma.connection.findUnique({
      where: { id },
      select: { id: true, name: true, baseUrl: true, type: true },
    })

    if (!conn || conn.type !== 'hyperv') {
      return NextResponse.json({ error: "Hyper-V connection not found" }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        connected: true,
        type: 'hyperv',
        name: conn.name,
        host: conn.baseUrl,
      }
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
