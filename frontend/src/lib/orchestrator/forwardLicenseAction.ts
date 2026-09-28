import { NextResponse } from "next/server"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { orchestratorHeaders } from "@/lib/orchestrator/headers"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

type ForwardLicenseActionOptions = {
  keepUpstreamStatus?: boolean
  downloadDisposition?: string
  fallbackError?: string
  // Refuse the action outside the provider tenant, as license/import does:
  // the connection and its leases belong to the whole instance.
  providerOnly?: boolean
}

// Keep authorization and proxy failures identical across license actions.
// Downloads retain the signed request text and their existing error shape.
export async function forwardLicenseAction(
  path: string,
  method: "GET" | "POST" | "DELETE",
  action: string,
  options: ForwardLicenseActionOptions = {},
) {
  if (options.providerOnly) {
    // Loaded on demand so the actions without the gate never pull the tenant
    // module (and its database client) in.
    const { requireProviderTenant } = await import("@/lib/tenant")
    const providerGate = await requireProviderTenant()
    if (providerGate) return providerGate
  }
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const res = await fetch(`${ORCHESTRATOR_URL}${path}`, {
      method,
      headers: orchestratorHeaders(),
      cache: "no-store",
    })

    let data: any = null
    if (options.downloadDisposition) {
      const text = await res.text()
      if (res.ok) {
        return new NextResponse(text, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": res.headers.get("content-disposition") || options.downloadDisposition,
            "Cache-Control": "no-store",
          },
        })
      }
      try { data = JSON.parse(text) } catch { /* non-JSON error body */ }
    } else {
      data = await res.json().catch(() => null)
    }

    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error: data?.error || `HTTP ${res.status}`,
          ...(data?.code ? { code: data.code } : {}),
          ...(!options.downloadDisposition && data?.portal_code ? { portal_code: data.portal_code } : {}),
        },
        { status: res.status },
      )
    }
    return NextResponse.json(data, { status: options.keepUpstreamStatus ? res.status : 200 })
  } catch (e: any) {
    console.error(`License ${action} failed:`, e?.message)
    const msg = e?.message || ""
    if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      return NextResponse.json(
        { success: false, error: "The ProxCenter backend (orchestrator) is not reachable.", code: "ORCHESTRATOR_UNAVAILABLE" },
        { status: 503 },
      )
    }
    return NextResponse.json({ success: false, error: msg || options.fallbackError || `Failed to ${action}` }, { status: 500 })
  }
}
