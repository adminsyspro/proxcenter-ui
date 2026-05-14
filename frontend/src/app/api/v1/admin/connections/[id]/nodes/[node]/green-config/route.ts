import { NextRequest, NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"
import { upsertNodeGreenConfig, deleteNodeGreenConfig } from "@/lib/db/greenConfig"
import { invalidateGreenResolution } from "@/lib/green/resolve"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string; node: string }> | { id: string; node: string } }

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const providerGate = await requireProviderTenant()

    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    const node = (params as any)?.node

    if (!id || !node) return NextResponse.json({ error: 'Missing connection/node id' }, { status: 400 })

    const body = await req.json().catch(() => ({})) as any

    const row = await upsertNodeGreenConfig(id, node, {
      datacenterId: body.datacenterId ?? null,
      tdpPerCoreW: body.tdpPerCoreW ?? null,
      wattsPerGbRam: body.wattsPerGbRam ?? null,
      overheadPerNodeW: body.overheadPerNodeW ?? null,
    })

    invalidateGreenResolution(id, node)

return NextResponse.json({ data: row })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const providerGate = await requireProviderTenant()

    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    const node = (params as any)?.node

    if (!id || !node) return NextResponse.json({ error: 'Missing connection/node id' }, { status: 400 })

    await deleteNodeGreenConfig(id, node)
    invalidateGreenResolution(id, node)

return new NextResponse(null, { status: 204 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
