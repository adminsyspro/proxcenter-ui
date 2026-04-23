import { NextResponse } from "next/server"

import { orchestratorFetch } from "@/lib/orchestrator"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET /api/v1/ssh/allowlist
// Proxies to the orchestrator and returns the structured allowlist.
// Any user with CONNECTION_VIEW can read this — it is not sensitive
// (no credentials, no hostnames — just the command schema).
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const data = await orchestratorFetch("/ssh/allowlist")
    return NextResponse.json(data)
  } catch (error: any) {
    if ((error as any)?.code !== "ORCHESTRATOR_UNAVAILABLE") {
      console.error("Failed to fetch SSH allowlist:", String(error?.message || "").replace(/[\r\n]/g, ""))
    }
    return NextResponse.json(
      { error: error.message || "Failed to fetch SSH allowlist" },
      { status: 500 }
    )
  }
}
