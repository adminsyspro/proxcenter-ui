import { NextResponse } from "next/server"

import { getCurrentTenantId, userHasAccessToTenant } from "@/lib/tenant"
import { holdsWriteScope } from "@/lib/api-tokens/grantable"
import { ALL_SCOPE_IDS, FLEET_SCOPE_IDS, isCreatorCheckedScope } from "@/lib/api-tokens/scopes"

import { requireApiTokenAdmin } from "../_shared"

export const runtime = "nodejs"

// Which scopes the caller could put on a token for this tenant and connection
// perimeter (mirrors the creation-time check). Not license-gated, like the
// token list.
export async function GET(req: Request) {
  const guard = await requireApiTokenAdmin()
  if (!guard.ok) return guard.response!
  const ctx = guard.ctx!

  const params = new URL(req.url).searchParams
  const tenantId = params.get("tenantId") || (await getCurrentTenantId())
  const connectionIds = (params.get("connectionIds") ?? "")
    .split(",")
    .map(c => c.trim())
    .filter(Boolean)

  // A token restricted to connections never carries a fleet-wide scope.
  const candidates = connectionIds.length > 0 ? ALL_SCOPE_IDS.filter(s => !FLEET_SCOPE_IDS.includes(s)) : ALL_SCOPE_IDS
  if (ctx.isAdmin) return NextResponse.json({ data: { grantable: [...candidates] } })

  if (!ctx.userId || !(await userHasAccessToTenant(ctx.userId, tenantId))) {
    return NextResponse.json({ error: "Tenant not accessible" }, { status: 403 })
  }

  const perimeter = connectionIds.length > 0 ? connectionIds : null
  const grantable: string[] = []
  for (const scope of candidates) {
    if (!isCreatorCheckedScope(scope) || await holdsWriteScope(ctx.userId, tenantId, scope, perimeter)) grantable.push(scope)
  }
  return NextResponse.json({ data: { grantable } })
}
