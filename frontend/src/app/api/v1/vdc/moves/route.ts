import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"
import { listMoves } from "@/lib/vdc/move/status"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET /api/v1/vdc/moves[?active=1] : the moves between vDCs of the caller's tenant (all of them for the provider). */
export async function GET(req: Request) {
  const denied = await checkPermission(PERMISSIONS.VM_VIEW)
  if (denied) return denied
  try {
    const tenantId = await getCurrentTenantId()
    const activeOnly = new URL(req.url).searchParams.get("active") === "1"

    return NextResponse.json({ data: await listMoves({ tenantId, isProvider: tenantId === DEFAULT_TENANT_ID, activeOnly }) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 })
  }
}
