import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"
import { audit } from "@/lib/audit"
import { syncNetworkZones } from "@/lib/vdc/tenantNetworkMembers"
import { getTenantNetwork } from "@/lib/vdc/tenantNetworks"
import { mapTenantNetworkError } from "@/lib/vdc/httpErrors"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

// POST /api/v1/admin/tenant-networks/[id]/sync
// Bring the zone of every member back to its own peers plus the other
// members', rewriting and applying only where Proxmox differs (#901).
export async function POST(_req: Request, ctx: RouteContext) {
  const params = await Promise.resolve(ctx.params)
  const id = (params as any)?.id
  if (!id) return NextResponse.json({ error: "Missing tenant network ID" }, { status: 400 })
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied
  try {
    const network = await getTenantNetwork(id)
    const zoneSync = await syncNetworkZones(id)
    await audit({
      action: "update",
      category: "settings",
      resourceType: "tenant-network",
      resourceId: id,
      resourceName: network.name,
      details: { operation: "zone-sync", zoneSync },
      status: "success",
    })
    return NextResponse.json({ data: { zoneSync, network } })
  } catch (e: any) {
    const { status, message } = mapTenantNetworkError(e)
    return NextResponse.json({ error: message }, { status })
  }
}
