import { NextRequest, NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getVdcById, refreshVdcUsage } from "@/lib/vdc"
import { requireProviderTenant } from "@/lib/tenant"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

// GET /api/v1/admin/vdcs/[id]/usage — get vDC quota + usage (with optional refresh)
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing vDC ID" }, { status: 400 })

    const providerGate = await requireProviderTenant()

    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const vdc = await getVdcById(id)

    if (!vdc) {
      return NextResponse.json({ error: "vDC not found" }, { status: 404 })
    }

    const shouldRefresh =
      req.nextUrl.searchParams.get("refresh") === "true" ||
      !vdc.usage?.lastSyncedAt

    let usage = vdc.usage

    if (shouldRefresh) {
      usage = await refreshVdcUsage(id)
    }

    return NextResponse.json({
      data: {
        quota: vdc.quota,
        usage: usage,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
