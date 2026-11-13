import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"
import { listMoves } from "@/lib/vdc/move/status"
import type { Principal } from "@/lib/auth/principal"
import { filterToTokenPerimeter } from "@/lib/api-tokens/scope"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET /api/v1/vdc/moves/{moveId}: one move, polled by the dialog and the task bar. Another tenant's move answers 404. */
async function handleGet(_req: Request, ctx: { params: Promise<{ moveId: string }>; principal?: Principal }) {
  const denied = await checkPermission(PERMISSIONS.VM_VIEW)
  if (denied) return denied
  const { moveId } = await ctx.params
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(moveId)) return NextResponse.json({ error: "Invalid move id" }, { status: 400 })
  try {
    const tenantId = await getCurrentTenantId()
    const found = await listMoves({ tenantId, isProvider: tenantId === DEFAULT_TENANT_ID, moveId, limit: 1 })
    const [move] = await filterToTokenPerimeter(found, ctx.principal, m => [m.sourceConnectionId, m.targetConnectionId])
    if (!move) return NextResponse.json({ error: "Move not found" }, { status: 404 })

    return NextResponse.json({ data: move })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 })
  }
}

export const GET = withPublicApiGuard("vdc-move-get", handleGet)
