import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

/**
 * GET /api/v1/hyperv/[id]/vms
 * List VMs on a Hyper-V host.
 * For v1, automatic VM listing is not available (no WinRM/PowerShell integration).
 * Users should export VMs as VHDX and provide disk paths during migration.
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
      select: { id: true, name: true, type: true },
    })

    if (!conn || conn.type !== 'hyperv') {
      return NextResponse.json({ error: "Hyper-V connection not found" }, { status: 404 })
    }

    return NextResponse.json({
      data: [],
      message: "Hyper-V VM listing requires manual configuration. Export VMs as VHDX and provide disk paths during migration.",
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
