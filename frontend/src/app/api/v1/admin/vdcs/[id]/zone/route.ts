import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"
import { audit } from "@/lib/audit"
import { getVdcZoneStatus, syncVdcZone } from "@/lib/vdc/transportOps"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

async function gate(ctx: RouteContext): Promise<{ id: string } | Response> {
  const params = await Promise.resolve(ctx.params)
  const id = (params as any)?.id
  if (!id) return NextResponse.json({ error: "Missing vDC ID" }, { status: 400 })
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied
  return { id }
}

function fail(e: any): NextResponse {
  const msg = e?.message || String(e)
  if (msg.includes("not found") && msg.startsWith("vDC")) return NextResponse.json({ error: "vDC not found" }, { status: 404 })
  if (msg.startsWith("VXLAN transport") || msg.includes("has no SDN zone")) return NextResponse.json({ error: msg }, { status: 400 })
  return NextResponse.json({ error: msg }, { status: 502 })
}

// GET /api/v1/admin/vdcs/[id]/zone
// Desired zone (from the stored transport) next to the zone Proxmox runs (#899).
export async function GET(_req: Request, ctx: RouteContext) {
  const g = await gate(ctx)
  if (g instanceof Response) return g
  try {
    return NextResponse.json({ data: await getVdcZoneStatus(g.id) })
  } catch (e: any) {
    return fail(e)
  }
}

// POST /api/v1/admin/vdcs/[id]/zone
// Push the desired peers and MTU to Proxmox (recreating a missing zone) and apply.
export async function POST(_req: Request, ctx: RouteContext) {
  const g = await gate(ctx)
  if (g instanceof Response) return g
  try {
    const result = await syncVdcZone(g.id)
    await audit({
      action: "update",
      category: "settings",
      resourceType: "vdc",
      resourceId: g.id,
      resourceName: result.zoneName ?? g.id,
      details: { operation: "zone-sync", changed: result.changed, peers: result.desired.peers, mtu: result.desired.mtu },
      status: "success",
    })
    return NextResponse.json({ data: result })
  } catch (e: any) {
    return fail(e)
  }
}
