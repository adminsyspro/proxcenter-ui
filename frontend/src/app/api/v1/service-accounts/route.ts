// /api/v1/service-accounts (issue #1404): the service accounts the caller
// reaches, and the creation of one. Session: admin.apitokens (.view to list).
// API token: identity:read / identity:write.
import { NextResponse } from "next/server"

import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { withAudit } from "@/lib/audit/withAudit"
import { createServiceAccount, listServiceAccounts } from "@/lib/service-accounts"
import { errorResponse, identityReader, identityWriter, targetTenantOf } from "@/lib/service-accounts/access"

export const runtime = "nodejs"

async function handleGet() {
  const caller = await identityReader()
  if (caller.denied) return caller.denied
  try {
    return NextResponse.json({ data: await listServiceAccounts(caller.tenantScope) })
  } catch (e) {
    return errorResponse(e, "list")
  }
}

async function handlePost(req: Request) {
  const caller = await identityWriter()
  if (caller.denied) return caller.denied
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  // Another tenant than the caller's own answers like a missing one.
  const tenantId = targetTenantOf(caller, body.tenantId)
  if (!tenantId) return NextResponse.json({ error: "Tenant not found" }, { status: 404 })
  try {
    const account = await createServiceAccount({ tenantId, name: body.name, description: body.description })
    return NextResponse.json({ data: account }, { status: 201 })
  } catch (e) {
    return errorResponse(e, "create")
  }
}

export const GET = withPublicApiGuard("service-accounts-list", handleGet)
export const POST = withAudit({ category: "api_tokens", resourceType: "service_account", resourceNameBodyField: "name" }, withPublicApiGuard("service-account-create", handlePost))
