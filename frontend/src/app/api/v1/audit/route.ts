// src/app/api/v1/audit/route.ts
import { NextResponse } from "next/server"

import { getAuditLogs, type AuditCategory, type AuditAction, type AuditStatus } from "@/lib/audit"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"

export const runtime = "nodejs"

// The audit page asks for 25, 50 or 100 rows per page. A larger page is a
// mistake or a probe, and an unbounded one would hand the whole journal to a
// single query; absent or unparseable values fall back to the page default.
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

function pageLimit(raw: string | null): number {
  const n = Number.parseInt(raw ?? "", 10)

  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT

  return Math.min(n, MAX_LIMIT)
}

function pageOffset(raw: string | null): number {
  const n = Number.parseInt(raw ?? "", 10)

  return Number.isFinite(n) && n > 0 ? n : 0
}

export async function GET(req: Request) {
  try {
    // RBAC: Check admin.audit permission
    const denied = await checkPermission(PERMISSIONS.ADMIN_AUDIT)

    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const tenantId = await getCurrentTenantId()

    const options = {
      tenantId,
      limit: pageLimit(searchParams.get("limit")),
      offset: pageOffset(searchParams.get("offset")),
      category: searchParams.get("category") as AuditCategory | undefined,
      action: searchParams.get("action") as AuditAction | undefined,
      userId: searchParams.get("userId") || undefined,
      resourceType: searchParams.get("resourceType") || undefined,
      resourceId: searchParams.get("resourceId") || undefined,
      status: searchParams.get("status") as AuditStatus | undefined,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      search: searchParams.get("search") || undefined,
    }

    // Nettoyer les undefined
    Object.keys(options).forEach(key => {
      if (options[key as keyof typeof options] === undefined) {
        delete options[key as keyof typeof options]
      }
    })

    const result = await getAuditLogs(options)

    return NextResponse.json(result)
  } catch (error: any) {
    console.error("GET audit error:", error)

return NextResponse.json({ error: error?.message || "Server error" }, { status: 500 })
  }
}
