import { NextResponse } from "next/server"

import { getCurrentTenantId, userHasAccessToTenant } from "@/lib/tenant"
import { holdsWriteScope } from "@/lib/api-tokens/grantable"
import { ALL_SCOPE_IDS, READ_SCOPE_IDS, WRITE_SCOPE_IDS } from "@/lib/api-tokens/scopes"

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

  if (ctx.isAdmin) return NextResponse.json({ data: { grantable: [...ALL_SCOPE_IDS] } })

  if (!ctx.userId || !(await userHasAccessToTenant(ctx.userId, tenantId))) {
    return NextResponse.json({ error: "Tenant not accessible" }, { status: 403 })
  }

  const perimeter = connectionIds.length > 0 ? connectionIds : null
  const grantable: string[] = [...READ_SCOPE_IDS]
  for (const scope of WRITE_SCOPE_IDS) {
    if (await holdsWriteScope(ctx.userId, tenantId, scope, perimeter)) grantable.push(scope)
  }
  return NextResponse.json({ data: { grantable } })
}
