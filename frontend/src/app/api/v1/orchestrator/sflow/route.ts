import { NextRequest, NextResponse } from "next/server"

import { orchestratorFetch } from "@/lib/orchestrator"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"

export const runtime = "nodejs"

// GET /api/v1/orchestrator/sflow?endpoint=status|top-talkers|agents|health
//
// Trace (2026-08): the Go orchestrator's sFlow aggregator is a single
// fleet-wide collector (internal/sflow) with NO tenant/X-Tenant-ID handling
// anywhere in that package: the agents and the top talkers name the
// connection of a node, nothing names a tenant. This route is gated
// provider-only. The volume between the zones of a policy is the
// micro-segmentation relay's (per connection, with its rights), not this one.
export async function GET(request: NextRequest) {
  try {
    const providerGate = await requireProviderTenant()
    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const endpoint = searchParams.get("endpoint") || "status"

    const allowed = ["status", "top-talkers", "agents", "health"]
    if (!allowed.includes(endpoint)) {
      return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 })
    }

    // Forward query params (n, window, etc.)
    const params = new URLSearchParams()
    for (const [key, value] of searchParams.entries()) {
      if (key !== "endpoint") {
        params.set(key, value)
      }
    }

    const queryString = params.toString() ? `?${params.toString()}` : ""
    const data = await orchestratorFetch(`/sflow/${endpoint}${queryString}`)

    return NextResponse.json(data)
  } catch (error: any) {
    if ((error as any)?.code !== "ORCHESTRATOR_UNAVAILABLE") {
      console.error("Failed to fetch sFlow data:", String(error?.message || "").replace(/[\r\n]/g, ""))
    }

    return NextResponse.json(
      { error: error.message || "Failed to fetch sFlow data" },
      { status: 500 }
    )
  }
}
