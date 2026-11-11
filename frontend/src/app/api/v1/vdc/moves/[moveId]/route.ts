import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"
import { listMoves } from "@/lib/vdc/move/status"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET /api/v1/vdc/moves/{moveId}: one move, polled by the dialog and the task bar. Another tenant's move answers 404. */
export async function GET(_req: Request, ctx: { params: Promise<{ moveId: string }> }) {
  const denied = await checkPermission(PERMISSIONS.VM_VIEW)
  if (denied) return denied
  const { moveId } = await ctx.params
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(moveId)) return NextResponse.json({ error: "Invalid move id" }, { status: 400 })
  try {
    const tenantId = await getCurrentTenantId()
    const [move] = await listMoves({ tenantId, isProvider: tenantId === DEFAULT_TENANT_ID, moveId, limit: 1 })
    if (!move) return NextResponse.json({ error: "Move not found" }, { status: 404 })

    return NextResponse.json({ data: move })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 })
  }
}
