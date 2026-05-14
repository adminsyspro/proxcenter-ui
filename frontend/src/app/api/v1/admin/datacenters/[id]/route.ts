import { NextRequest, NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"
import { deleteDatacenter, getDatacenterById, updateDatacenter } from "@/lib/db/datacenters"
import { invalidateGreenResolution } from "@/lib/green/resolve"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const providerGate = await requireProviderTenant()

    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    const dc = await getDatacenterById(id)

    if (!dc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

return NextResponse.json({ data: dc })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const providerGate = await requireProviderTenant()

    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    const body = await req.json().catch(() => ({})) as any

    const dc = await updateDatacenter(id, {
      name: body.name,
      locationLabel: body.locationLabel ?? undefined,
      country: body.country ?? undefined,
      latitude: body.latitude ?? undefined,
      longitude: body.longitude ?? undefined,
      pue: body.pue,
      electricityPrice: body.electricityPrice,
      currency: body.currency,
      co2Factor: body.co2Factor,
      co2CountryPreset: body.co2CountryPreset ?? undefined,
      tdpPerCoreW: typeof body.tdpPerCoreW === 'number' ? body.tdpPerCoreW : undefined,
      wattsPerGbRam: typeof body.wattsPerGbRam === 'number' ? body.wattsPerGbRam : undefined,
      overheadPerNodeW: typeof body.overheadPerNodeW === 'number' ? body.overheadPerNodeW : undefined,
      comment: body.comment === undefined ? undefined : (body.comment ?? null),
      isDefault: typeof body.isDefault === 'boolean' ? body.isDefault : undefined,
    })

    invalidateGreenResolution()

return NextResponse.json({ data: dc })
  } catch (e: any) {
    const msg = e?.message || String(e)
    const status = msg.includes('not found') ? 404 : 400


return NextResponse.json({ error: msg }, { status })
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

    await deleteDatacenter(id)
    invalidateGreenResolution()

return new NextResponse(null, { status: 204 })
  } catch (e: any) {
    const msg = e?.message || String(e)


    // Conflict: still referenced or only default
    return NextResponse.json({ error: msg }, { status: 409 })
  }
}
