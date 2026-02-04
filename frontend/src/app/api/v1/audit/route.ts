// src/app/api/v1/audit/route.ts
import { NextResponse } from "next/server"

import { getAuditLogs, type AuditCategory, type AuditAction, type AuditStatus } from "@/lib/audit"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function GET(req: Request) {
  try {
    // RBAC: Check admin.audit permission
    const denied = await checkPermission(PERMISSIONS.ADMIN_AUDIT)

    if (denied) return denied

    const { searchParams } = new URL(req.url)

    const options = {
      limit: parseInt(searchParams.get("limit") || "100"),
      offset: parseInt(searchParams.get("offset") || "0"),
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

    const result = getAuditLogs(options)

    return NextResponse.json(result)
  } catch (error: any) {
    console.error("Erreur GET audit:", error)
    
return NextResponse.json({ error: error?.message || "Erreur serveur" }, { status: 500 })
  }
}
