import { NextRequest, NextResponse } from "next/server"

import { orchestratorFetch } from "@/lib/orchestrator"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"

export const runtime = "nodejs"

// GET /api/v1/orchestrator/sflow?endpoint=status|top-talkers|top-pairs|top-ports|agents
//
// Trace (2026-08): the Go orchestrator's sFlow aggregator is a single
// fleet-wide collector (internal/sflow) with NO tenant/X-Tenant-ID handling
// anywhere in that package. Row shapes are mixed: TopTalker and the
// status.agents entries DO carry a connection_id, but TopPair, TopPort,
// TopEndpoint (top-sources/top-destinations), IPPair and every timeseries/*
// point carry only vmid/IP/port — no connection or tenant linkage at all.
// Partially filtering only the endpoints that happen to carry connection_id
// would still let a tenant pivot through top-pairs/ip-pairs/timeseries to
// see every other tenant's VM traffic. Per the brief's rule 5 (no shape ->
// no invented mapping), this route is gated provider-only instead.
export async function GET(request: NextRequest) {
  try {
    const providerGate = await requireProviderTenant()
    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const endpoint = searchParams.get("endpoint") || "status"

    const allowed = ["status", "top-talkers", "top-pairs", "top-ports", "top-sources", "top-destinations", "ip-pairs", "timeseries/vm", "timeseries/all-vms", "timeseries/ip", "agents"]
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
