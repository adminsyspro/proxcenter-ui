import { NextResponse } from "next/server"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"
import { orchestratorHeaders } from "@/lib/orchestrator/headers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

function unavailable(e: any): NextResponse | null {
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
  return null
}

export async function GET() {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/license/imports`, {
      headers: orchestratorHeaders(),
      cache: "no-store",
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) return NextResponse.json(data ?? { error: `HTTP ${res.status}` }, { status: res.status })
    return NextResponse.json(data)
  } catch (e: any) {
    const u = unavailable(e)
    if (u) return u
    return NextResponse.json({ error: e?.message || "Failed to list license imports" }, { status: 500 })
  }
}
