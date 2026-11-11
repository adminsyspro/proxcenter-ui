import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { audit } from "@/lib/audit"
import { withAudit } from "@/lib/audit/withAudit"
import { createEvpnZone, listEvpnZones } from "@/lib/vdc/evpnZones"
import { evpnFail, evpnGate } from "@/lib/vdc/evpnRouteGate"

export const runtime = "nodejs"

// GET /api/v1/admin/evpn-zones
// Provider EVPN zones shared between clusters (#1334).
export async function GET() {
  const denied = await evpnGate()
  if (denied) return denied
  try {
    return NextResponse.json({ data: await listEvpnZones() })
  } catch (e: any) {
    return evpnFail(e)
  }
}

// POST /api/v1/admin/evpn-zones
// Declares a zone on its clusters: created, or adopted where Proxmox runs it.
async function handlePost(req: NextRequest) {
  const denied = await evpnGate()
  if (denied) return denied
  try {
    const session = await getServerSession(authOptions)
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

export const POST = withAudit({ category: "sdn", resourceType: "evpn_zone" }, handlePost)
