import { NextResponse } from "next/server"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { orchestratorHeaders } from "@/lib/orchestrator/headers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"
const DEFAULT_DISPOSITION = 'attachment; filename="proxcenter-license-request.json"'

// Downloads the signed license request built by the orchestrator. The file
// is opaque here: it is streamed as-is so the portal verifies the exact bytes.
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/license/request`, {
      headers: orchestratorHeaders(),
      cache: "no-store",
    })
    const text = await res.text()

    if (!res.ok) {
      let data: any = null
      try { data = JSON.parse(text) } catch { /* non-JSON error body */ }
      return NextResponse.json(
        { success: false, error: data?.error || `HTTP ${res.status}`, ...(data?.code ? { code: data.code } : {}) },
        { status: res.status }
      )
    }

    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": res.headers.get("content-disposition") || DEFAULT_DISPOSITION,
        "Cache-Control": "no-store",
      },
    })
  } catch (e: any) {
    console.error("License request generation failed:", e?.message)
    const msg = e?.message || ""
    if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      return NextResponse.json(
        { success: false, error: "The ProxCenter backend (orchestrator) is not reachable.", code: "ORCHESTRATOR_UNAVAILABLE" },
        { status: 503 }
      )
    }
    return NextResponse.json({ success: false, error: msg || "Failed to generate the license request" }, { status: 500 })
  }
}
