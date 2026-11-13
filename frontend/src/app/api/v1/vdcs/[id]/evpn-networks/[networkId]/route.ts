import { NextResponse } from "next/server"

import type { Principal } from "@/lib/auth/principal"
import { withAudit } from "@/lib/audit/withAudit"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { evpnContextForVdc, setEvpnNetworkPresence } from "@/lib/vdc/evpnNetworks"
import { mapTenantNetworkError } from "@/lib/vdc/httpErrors"
import { checkVnetPermission } from "@/lib/vdc/vnetPermission"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string; networkId: string }> | { id: string; networkId: string }
  principal?: Principal
}

// PUT /api/v1/vdcs/{id}/evpn-networks/{networkId}
// Body: { vdcIds: string[] }. Sets the vDCs of the tenant that carry the
// network (#1334): created where newly listed, removed where left out.
// Open to API tokens (scope network:write, issue #1360): every vDC added or
// removed is judged like the one in the URL, tenant and connection perimeter.
async function putHandler(req: Request, ctx: RouteContext) {
  try {
    const params = await Promise.resolve(ctx.params)
    const vdcId = (params as any)?.id
    const networkId = (params as any)?.networkId
    if (!vdcId || !networkId) return NextResponse.json({ error: "Missing params" }, { status: 400 })

    const denied = await checkVnetPermission(ctx.principal, vdcId, PERMISSIONS.SDN_VNET_EDIT)
    if (denied) return denied

    const body = await req.json().catch(() => ({}))
    if (!Array.isArray(body?.vdcIds)) return NextResponse.json({ error: "vdcIds must be an array" }, { status: 400 })
    const vdcIds: string[] = [...new Set<string>(body.vdcIds.filter((x: unknown) => typeof x === "string"))].slice(0, 200)

    const tenantId = await getCurrentTenantId()
    try {
      // The caller must hold the right on every vDC it changes, not only on
      // the one in the URL.
      const context = await evpnContextForVdc(vdcId, tenantId)
      const network = context.networks.find(n => n.id === networkId)
      if (!network) return NextResponse.json({ error: "Network not found" }, { status: 404 })
      const current = new Set(network.vdcIds)
      const wanted = new Set(vdcIds)
      for (const id of vdcIds) {
        if (current.has(id)) continue
        const refused = await checkVnetPermission(ctx.principal, id, PERMISSIONS.SDN_VNET_CREATE)
        if (refused) return refused
      }
      for (const id of network.vdcIds) {
        if (wanted.has(id)) continue
        const refused = await checkVnetPermission(ctx.principal, id, PERMISSIONS.SDN_VNET_DELETE)
        if (refused) return refused
      }

      return NextResponse.json({ data: await setEvpnNetworkPresence(networkId, tenantId, vdcIds) })
    } catch (err: any) {
      const msg = err?.message || String(err)
      if (msg.includes("vDC not found")) return NextResponse.json({ error: msg }, { status: 404 })
      if (msg.includes("Quota exceeded")) return NextResponse.json({ error: msg }, { status: 409 })
      if (msg.startsWith("Tenant network:")) {
        const mapped = mapTenantNetworkError(err)
        return NextResponse.json({ error: mapped.message }, { status: mapped.status })
      }
      if (/^Failed to (create|update|delete) SDN/.test(msg)) return NextResponse.json({ error: msg }, { status: 502 })
      throw err
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const PUT = withAudit({ category: "sdn", resourceType: "vnet", resourceParam: "networkId" }, withPublicApiGuard("vdc-evpn-network-update", putHandler))
