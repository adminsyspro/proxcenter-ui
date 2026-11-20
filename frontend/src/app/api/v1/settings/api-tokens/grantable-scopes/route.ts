import { NextResponse } from "next/server"

import { getCurrentTenantId, userHasAccessToTenant } from "@/lib/tenant"
import { holdsScope, holdsWriteScope } from "@/lib/api-tokens/grantable"
import { getServiceAccount } from "@/lib/service-accounts"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"
import { ALL_SCOPE_IDS, FLEET_SCOPE_IDS, isCreatorCheckedScope, PROVIDER_ONLY_SCOPE_IDS } from "@/lib/api-tokens/scopes"

import { requireApiTokenAdmin } from "../_shared"

export const runtime = "nodejs"

// Which scopes the caller could put on a token for this tenant and connection
// perimeter (mirrors the creation-time check). Not license-gated, like the
// token list. With `serviceAccountId` (issue #1404) the tenant is the
// account's, and only the scopes the account itself holds are kept.
export async function GET(req: Request) {
  const guard = await requireApiTokenAdmin()
  if (!guard.ok) return guard.response!
  const ctx = guard.ctx!

  const params = new URL(req.url).searchParams
  const serviceAccountId = params.get("serviceAccountId")
  let tenantId = params.get("tenantId") || (await getCurrentTenantId())
  if (serviceAccountId) {
    const callerTenant = await getCurrentTenantId()
    const account = await getServiceAccount(serviceAccountId)
    if (!account || (callerTenant !== DEFAULT_TENANT_ID && account.tenantId !== callerTenant)) {
      return NextResponse.json({ error: "Service account not found" }, { status: 404 })
    }
    tenantId = account.tenantId
  }
  const connectionIds = (params.get("connectionIds") ?? "")
    .split(",")
    .map(c => c.trim())
    .filter(Boolean)

  // A token restricted to connections never carries a fleet-wide scope.
  const perimeter = connectionIds.length > 0 ? connectionIds : null
  let candidates = connectionIds.length > 0 ? ALL_SCOPE_IDS.filter(s => !FLEET_SCOPE_IDS.includes(s)) : ALL_SCOPE_IDS
  // A customer tenant's token never carries a scope whose routes answer the provider only.
  if (tenantId !== DEFAULT_TENANT_ID) candidates = candidates.filter(s => !PROVIDER_ONLY_SCOPE_IDS.includes(s))
  if (serviceAccountId) {
    const held: string[] = []
    for (const scope of candidates) if (await holdsScope(serviceAccountId, tenantId, scope, perimeter)) held.push(scope)
    candidates = held
  }
  if (ctx.isAdmin) return NextResponse.json({ data: { grantable: [...candidates] } })

  if (!ctx.userId || !(await userHasAccessToTenant(ctx.userId, tenantId))) {
    return NextResponse.json({ error: "Tenant not accessible" }, { status: 403 })
  }

  const grantable: string[] = []
  for (const scope of candidates) {
    if (!isCreatorCheckedScope(scope) || await holdsWriteScope(ctx.userId, tenantId, scope, perimeter)) grantable.push(scope)
  }
  return NextResponse.json({ data: { grantable } })
}
