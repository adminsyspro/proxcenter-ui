import { NextResponse } from "next/server"

import type { Principal } from "@/lib/auth/principal"
import { PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { evpnContextForVdc } from "@/lib/vdc/evpnNetworks"
import { checkVnetPermission } from "@/lib/vdc/vnetPermission"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string }; principal?: Principal }

// GET /api/v1/vdcs/{id}/evpn-networks
// Whether the vDC is attached to a shared EVPN zone (#1334), the vDCs of the
// tenant attached to the same zone, and the networks it holds there.
// Public API: scope vdcs:read or network:write (issue #1360).
async function handleGet(_req: Request, ctx: RouteContext) {
  try {
    const params = await Promise.resolve(ctx.params)
    const vdcId = (params as any)?.id
    if (!vdcId) return NextResponse.json({ error: "Missing vDC ID" }, { status: 400 })

    const denied = await checkVnetPermission(ctx.principal, vdcId, PERMISSIONS.SDN_VNET_VIEW)
    if (denied) return denied

    try {
      return NextResponse.json({ data: await evpnContextForVdc(vdcId, await getCurrentTenantId()) })
    } catch (err: any) {
      const msg = err?.message || String(err)
      // The provider tenant has no vDC of its own: nothing to offer.
      if (msg.includes("vDC not found")) return NextResponse.json({ data: { available: false, vdcs: [], networks: [] } })
      throw err
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const GET = withPublicApiGuard("vdc-evpn-networks", handleGet)
