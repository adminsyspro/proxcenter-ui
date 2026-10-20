import { NextResponse } from "next/server"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"
import { orchestratorHeaders } from "@/lib/orchestrator/headers"
import { invalidateLicenseExclusionCache } from "@/lib/license/exclusions"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

// PUT /api/v1/license/exclusions/{connectionId} {"excluded": boolean}
// Declares a cluster outside the license, or counts it again (roadmap#58).
// A provider-level license action, behind the same gates as an import.
async function handlePut(req: Request, ctx: { params: Promise<{ connectionId: string }> }) {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied

  const { connectionId } = await ctx.params
  const body = await req.json().catch(() => null)
  if (typeof body?.excluded !== "boolean") {
    return NextResponse.json({ error: "excluded must be a boolean" }, { status: 400 })
  }
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/license/exclusions/${encodeURIComponent(connectionId)}`, {
      method: "PUT",
      headers: await orchestratorHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ excluded: body.excluded }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) return NextResponse.json(data ?? { error: `HTTP ${res.status}` }, { status: res.status })
    // The pveFetch write guard caches the flag: the change must bite at once.
    invalidateLicenseExclusionCache(connectionId)
    return NextResponse.json(data)
  } catch (e: any) {
    const msg = e?.message || ""
    if (/ECONNREFUSED|fetch failed|ENOTFOUND|timeout/.test(msg)) {
      return NextResponse.json(
        { error: "The ProxCenter backend (orchestrator) is not reachable.", code: "ORCHESTRATOR_UNAVAILABLE" },
        { status: 503 },
      )
    }
    return NextResponse.json({ error: msg || "Failed to update the license exclusion" }, { status: 500 })
  }
}

export const PUT = withAudit({ category: "system", resourceType: "exclusion", resourceParam: "connectionId" }, handlePut)
