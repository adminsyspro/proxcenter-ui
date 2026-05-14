import { randomUUID } from "crypto"

import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { clearVdcScopeCache } from "@/lib/vdc/scope"
import { requireProviderTenant } from "@/lib/tenant"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

// GET /api/v1/admin/vdcs/{id}/shared-bridges
export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing vDC ID" }, { status: 400 })

    const providerGate = await requireProviderTenant()

    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const rows = await prisma.vdcSharedBridge.findMany({
      where: { vdcId: id },
      orderBy: { bridge: "asc" },
    })

    const data = rows.map(r => ({
      id: r.id,
      vdcId: r.vdcId,
      bridge: r.bridge,
      label: r.label ?? null,
      createdAt: r.createdAt.toISOString(),
    }))

    return NextResponse.json({ data })
  } catch (e: any) {
    console.error("[shared-bridges] GET error:", e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// PUT /api/v1/admin/vdcs/{id}/shared-bridges
// Body: { bridges: [{ bridge, label? }, ...] } - replaces the full set.
export async function PUT(req: Request, ctx: RouteContext) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing vDC ID" }, { status: 400 })

    const providerGate = await requireProviderTenant()

    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const body = await req.json().catch(() => ({}))

    const incoming: Array<{ bridge?: unknown; label?: unknown }> = Array.isArray(body?.bridges)
      ? body.bridges
      : []

    const cleaned: Array<{ bridge: string; label: string | null }> = []

    for (const item of incoming) {
      if (typeof item?.bridge !== "string" || !item.bridge.trim()) continue
      cleaned.push({
        bridge: item.bridge.trim(),
        label: typeof item.label === "string" ? item.label.trim() : null,
      })
    }

    const seen = new Set<string>()

    const unique = cleaned.filter((c) => {
      if (seen.has(c.bridge)) return false
      seen.add(c.bridge)

return true
    })

    const vdc = await prisma.vdc.findUnique({ where: { id }, select: { tenantId: true } })

    if (!vdc) return NextResponse.json({ error: "vDC not found" }, { status: 404 })

    const now = new Date()

    await prisma.$transaction([
      prisma.vdcSharedBridge.deleteMany({ where: { vdcId: id } }),
      ...(unique.length > 0
        ? [
            prisma.vdcSharedBridge.createMany({
              data: unique.map(sb => ({
                id: randomUUID(),
                vdcId: id,
                bridge: sb.bridge,
                label: sb.label,
                createdAt: now,
              })),
            }),
          ]
        : []),
    ])

    clearVdcScopeCache(vdc.tenantId)

    return NextResponse.json({ success: true, count: unique.length })
  } catch (e: any) {
    console.error("[shared-bridges] PUT error:", e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
