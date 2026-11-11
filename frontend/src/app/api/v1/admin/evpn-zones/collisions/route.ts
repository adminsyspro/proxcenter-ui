import { NextRequest, NextResponse } from "next/server"

import { audit } from "@/lib/audit"
import { withAudit } from "@/lib/audit/withAudit"
import { evpnFail, evpnGate } from "@/lib/vdc/evpnRouteGate"
import { auditVniCollisions, renumberVnet } from "@/lib/vdc/vniCollisions"

export const runtime = "nodejs"

// GET /api/v1/admin/evpn-zones/collisions
// VNIs that two clusters carry for unrelated networks.
export async function GET() {
  const denied = await evpnGate()
  if (denied) return denied
  try {
    return NextResponse.json({ data: await auditVniCollisions() })
  } catch (e: any) {
    return evpnFail(e)
  }
}

// POST /api/v1/admin/evpn-zones/collisions
// Moves one ProxCenter VXLAN network to a free VNI.
async function handlePost(req: NextRequest) {
  const denied = await evpnGate()
  if (denied) return denied
  try {
    const body = await req.json()
    const vdcVnetId = typeof body?.vdcVnetId === "string" ? body.vdcVnetId : ""
    if (!vdcVnetId) return NextResponse.json({ error: "vdcVnetId is required" }, { status: 400 })
    const result = await renumberVnet(vdcVnetId)
    await audit({
      action: "update",
      category: "settings",
      resourceType: "vdc-vnet",
      resourceId: result.vdcVnetId,
      details: { previousVni: result.previousVni, vni: result.vni, reason: "vni-collision" },
      status: "success",
    })
    return NextResponse.json({ data: result })
  } catch (e: any) {
    return evpnFail(e)
  }
}

export const POST = withAudit({ category: "sdn", resourceType: "vdc_vnet" }, handlePost)
