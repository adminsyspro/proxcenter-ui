import { NextResponse } from "next/server"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { orchestratorHeaders } from "@/lib/orchestrator/headers"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

export async function DELETE() {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/license/deactivate`, {
      method: "DELETE",
      headers: orchestratorHeaders(),
    })

    const data = await res.json()

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: data?.error || `HTTP ${res.status}` },
        { status: res.status }
      )
    }

    return NextResponse.json(data)
  } catch (e: any) {
    console.error("License deactivation failed:", e?.message)

    const msg = e?.message || ""
    if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      return NextResponse.json(
        {
          success: false,
          error: "The ProxCenter backend (orchestrator) is not reachable. Enterprise features require the backend container to be running. If you upgraded from Community to Enterprise, please follow the Enterprise installation guide to deploy the backend container.",
          code: "ORCHESTRATOR_UNAVAILABLE",
        },
        { status: 503 }
      )
    }

    return NextResponse.json(
      { success: false, error: msg || "Failed to deactivate license" },
      { status: 500 }
    )
  }
}
