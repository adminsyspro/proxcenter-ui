import { NextRequest, NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"
import { ensureDefaultDatacenter, insertDatacenter, listDatacenters } from "@/lib/db/datacenters"
import { invalidateGreenResolution } from "@/lib/green/resolve"

export const runtime = "nodejs"

export async function GET() {
  try {
    const providerGate = await requireProviderTenant()

    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    // First-visit migration: seed a "Default" datacentre from the legacy
    // settings.green row so existing installs see something on day one.
    await ensureDefaultDatacenter()

return NextResponse.json({ data: await listDatacenters() })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const providerGate = await requireProviderTenant()

    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const body = await req.json().catch(() => ({})) as any

    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'Missing name' }, { status: 400 })
    }

    const dc = await insertDatacenter({
      name: body.name,
      locationLabel: body.locationLabel ?? null,
      country: body.country ?? null,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      pue: typeof body.pue === 'number' ? body.pue : 1.4,
      electricityPrice: typeof body.electricityPrice === 'number' ? body.electricityPrice : 0.18,
      currency: typeof body.currency === 'string' ? body.currency : 'EUR',
      co2Factor: typeof body.co2Factor === 'number' ? body.co2Factor : 0.052,
      co2CountryPreset: body.co2CountryPreset ?? null,
      tdpPerCoreW: typeof body.tdpPerCoreW === 'number' ? body.tdpPerCoreW : 10,
      wattsPerGbRam: typeof body.wattsPerGbRam === 'number' ? body.wattsPerGbRam : 0.375,
      overheadPerNodeW: typeof body.overheadPerNodeW === 'number' ? body.overheadPerNodeW : 50,
      comment: body.comment ?? null,
      isDefault: !!body.isDefault,
    })

    invalidateGreenResolution()

return NextResponse.json({ data: dc })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
