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

/** GET /api/v1/vdc/moves[?active=1] : the moves between vDCs of the caller's tenant (all of them for the provider). */
async function handleGet(req: Request, ctx: { principal?: Principal }) {
  const denied = await checkPermission(PERMISSIONS.VM_VIEW)
  if (denied) return denied
  try {
    const tenantId = await getCurrentTenantId()
    const activeOnly = new URL(req.url).searchParams.get("active") === "1"

    const moves = await listMoves({ tenantId, isProvider: tenantId === DEFAULT_TENANT_ID, activeOnly })
    // A token restricted to some connections only sees the moves between them.
    return NextResponse.json({ data: await filterToTokenPerimeter(moves, ctx?.principal, m => [m.sourceConnectionId, m.targetConnectionId]) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 })
  }
}

export const GET = withPublicApiGuard("vdc-moves-list", handleGet)
