import { NextResponse } from "next/server"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"
import { orchestratorHeaders } from "@/lib/orchestrator/headers"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied

  const { id } = await ctx.params
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/license/import/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: orchestratorHeaders(),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) return NextResponse.json(data ?? { error: `HTTP ${res.status}` }, { status: res.status })
    return NextResponse.json(data)
  } catch (e: any) {
    const msg = e?.message || ""
    if (
      msg.includes("ECONNREFUSED") ||
      msg.includes("fetch failed") ||
      msg.includes("ENOTFOUND") ||
      msg.includes("timeout")
    ) {
      return NextResponse.json(
        { error: "The ProxCenter backend (orchestrator) is not reachable.", code: "ORCHESTRATOR_UNAVAILABLE" },
        { status: 503 },
      )
    }
    return NextResponse.json({ error: msg || "Failed to remove license import" }, { status: 500 })
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied

  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  // Reject malformed input; an intentional clear must send an explicit [].
  if (!body || !Array.isArray(body.connection_ids)) {
    return NextResponse.json({ error: "connection_ids must be an array (use [] to clear)" }, { status: 400 })
  }
  const connectionIds = body.connection_ids
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/license/import/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: orchestratorHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ connection_ids: connectionIds }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) return NextResponse.json(data ?? { error: `HTTP ${res.status}` }, { status: res.status })
    return NextResponse.json(data)
  } catch (e: any) {
    const msg = e?.message || ""
    if (
      msg.includes("ECONNREFUSED") ||
      msg.includes("fetch failed") ||
      msg.includes("ENOTFOUND") ||
      msg.includes("timeout")
    ) {
      return NextResponse.json(
        { error: "The ProxCenter backend (orchestrator) is not reachable.", code: "ORCHESTRATOR_UNAVAILABLE" },
        { status: 503 },
      )
    }
    return NextResponse.json({ error: msg || "Failed to update license mapping" }, { status: 500 })
  }
}
