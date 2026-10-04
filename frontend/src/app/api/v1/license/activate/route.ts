import { NextResponse } from "next/server"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"
import { orchestratorHeaders } from "@/lib/orchestrator/headers"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

export async function POST(req: Request) {
  try {
    const providerGate = await requireProviderTenant()
    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const body = await req.json().catch(() => null)
    if (!body?.license) {
      return NextResponse.json(
        { success: false, error: "License key is required" },
        { status: 400 }
      )
    }

    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/license/activate`, {
      method: "POST",
      headers: orchestratorHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ license: body.license }),
    })

    const data = await res.json()

    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error: data?.error || `HTTP ${res.status}`,
          ...(data?.code ? { code: data.code } : {}),
          ...(data?.expected_fingerprint ? { expected_fingerprint: data.expected_fingerprint } : {}),
          ...(data?.actual_fingerprint ? { actual_fingerprint: data.actual_fingerprint } : {}),
        },
        { status: res.status }
      )
    }

    return NextResponse.json(data)
  } catch (e: any) {
    console.error("License activation failed:", e?.message)

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
      { success: false, error: msg || "Failed to activate license" },
      { status: 500 }
    )
  }
}
