import { NextResponse } from "next/server"
import { getActingSession } from "@/lib/auth/actingUser"
import { audit } from "@/lib/audit"
import { withAudit } from "@/lib/audit/withAudit"
import { createEvpnZone, listEvpnZones } from "@/lib/vdc/evpnZones"
import { evpnFail, evpnGate } from "@/lib/vdc/evpnRouteGate"
import type { Principal } from "@/lib/auth/principal"
import { filterToTokenPerimeter } from "@/lib/api-tokens/scope"
import { PERMISSIONS } from "@/lib/rbac"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"

export const runtime = "nodejs"

// GET /api/v1/admin/evpn-zones
// Provider EVPN zones shared between clusters (#1334).
async function handleGet(_req: Request, ctx: { principal?: Principal }) {
  const denied = await evpnGate(PERMISSIONS.ADMIN_SETTINGS_VIEW)
  if (denied) return denied
  try {
    // A token restricted to some connections sees the zones it fully covers.
    const zones = await filterToTokenPerimeter(await listEvpnZones(), ctx?.principal, z => z.members.map(m => m.connectionId))
    return NextResponse.json({ data: zones })
  } catch (e: any) {
    return evpnFail(e)
  }
}

export const GET = withPublicApiGuard("evpn-zones-list", handleGet)

// POST /api/v1/admin/evpn-zones
// Declares a zone on its clusters: created, or adopted where Proxmox runs it.
async function handlePost(req: Request) {
  const denied = await evpnGate()
  if (denied) return denied
  try {
    const session = await getActingSession()
    const body = await req.json()
    const result = await createEvpnZone(
      {
        name: body?.name,
        description: body?.description,
        zoneName: body?.zoneName,
        vrfVxlan: body?.vrfVxlan,
        mtu: body?.mtu,
        vniStart: body?.vniStart,
        vniEnd: body?.vniEnd,
        members: body?.members,
      },
      session?.user?.id ?? null,
    )
    await audit({
      action: "create",
      category: "settings",
      resourceType: "evpn-zone",
      resourceId: result.zone.id,
      resourceName: result.zone.name,
      details: {
        zoneName: result.zone.zoneName,
        vrfVxlan: result.zone.vrfVxlan,
        vniRange: `${result.zone.vniStart}-${result.zone.vniEnd}`,
        clusters: result.zone.members.map(m => m.connectionName),
        controllersCreated: result.zone.members.filter(m => m.controllerCreated).map(m => m.controller),
        applyErrors: result.applyErrors.length,
      },
      status: "success",
    })
    return NextResponse.json({ data: result.zone, applyErrors: result.applyErrors }, { status: 201 })
  } catch (e: any) {
    return evpnFail(e)
  }
}

export const POST = withAudit({ category: "sdn", resourceType: "evpn_zone" }, withPublicApiGuard("evpn-zone-create", handlePost))
