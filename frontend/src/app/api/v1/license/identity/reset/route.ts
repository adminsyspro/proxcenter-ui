import { NextResponse } from "next/server"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"
import { orchestratorHeaders } from "@/lib/orchestrator/headers"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

// Regenerates the install identity (new fingerprint). A license bound to the
// previous fingerprint stops matching until it is rebound on the portal.
export async function POST() {
  try {
    const providerGate = await requireProviderTenant()
    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/license/identity/reset`, {
      method: "POST",
      headers: orchestratorHeaders({ "Content-Type": "application/json" }),
    })
    const data = await res.json().catch(() => null)

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: data?.error || `HTTP ${res.status}`, ...(data?.code ? { code: data.code } : {}) },
        { status: res.status }
      )
    }
    return NextResponse.json(data)
  } catch (e: any) {
    console.error("Install identity reset failed:", e?.message)
    const msg = e?.message || ""
    if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      return NextResponse.json(
        { success: false, error: "The ProxCenter backend (orchestrator) is not reachable.", code: "ORCHESTRATOR_UNAVAILABLE" },
        { status: 503 }
      )
    }
    return NextResponse.json({ success: false, error: msg || "Failed to reset the install identity" }, { status: 500 })
  }
}
