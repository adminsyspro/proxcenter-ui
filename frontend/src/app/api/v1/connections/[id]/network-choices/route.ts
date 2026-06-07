import { NextResponse } from "next/server"

import { getCurrentTenantId } from "@/lib/tenant"
import { checkPermission, PERMISSIONS, buildNodeResourceId } from "@/lib/rbac"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { prisma } from "@/lib/db/prisma"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

// GET /api/v1/connections/{id}/network-choices?node=X
export async function GET(req: Request, ctx: RouteContext) {
  try {
    const params = await Promise.resolve(ctx.params)
    const connId = (params as any)?.id
    if (!connId) return NextResponse.json({ error: "Missing connection ID" }, { status: 400 })

    const url = new URL(req.url)
    const node = url.searchParams.get("node")
    if (!node) return NextResponse.json({ error: "Missing node query param" }, { status: 400 })

    // connection.view is enough to populate the VM-create network picker:
    // the endpoint only returns names a tenant is already authorised to
    // attach to (their vDC VNets + shared bridges). node.network would gate
    // real network-management operations, not this read-only helper.
    const resourceId = buildNodeResourceId(connId, node)
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "node", resourceId)
    if (denied) return denied

    const tenantId = await getCurrentTenantId()
    const infra = await getTenantInfrastructureScope(tenantId)
    // MSP tenants own whole clusters and may only query connections they own.
    // The shared getConnectionById below authorizes via the connection's OWN
    // tenantId, so without this gate an MSP user could pass a non-owned connId
    // and leak that cluster's bridge/VNet choices.
    if (infra.kind === 'msp' && !infra.connectionIds.has(connId)) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }
    // provider + msp (maskingScope null) take the full-cluster branch below
    // (all physical bridges + all SDN VNets); iaas tenants get their vDC slice.
    const scope = maskingScope(infra)

    const connMeta = await prisma.connection.findUnique({ where: { id: connId }, select: { tenantId: true } })
    if (!connMeta) return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    const pveConn = await getConnectionById(connId, connMeta.tenantId)

    // Subnet info per VNet pve_name. The DeployWizard's CloudInit step
    // uses this to pre-fill IP/gateway/DNS fields for the selected VNet
    // (so the user gets an "Auto-allocated from <CIDR>" hint and a fixed
    // gateway, both driven by IPAM rather than typed by hand).
    type SubnetInfo = { cidr: string; gateway: string; dnsServers: string[]; subnetId: string }
    const subnetByPveName = new Map<string, SubnetInfo>()
    {
      const subnetRows = await prisma.vdcVnet.findMany({
        where: {
          vdc: { connectionId: connId, enabled: true },
          subnet: { ipamEnabled: true },
        },
        select: {
          pveName: true,
          subnet: { select: { id: true, cidr: true, gateway: true, dnsServers: true } },
        },
      })
      for (const r of subnetRows) {
        if (!r.subnet) continue
        subnetByPveName.set(r.pveName, {
          subnetId: r.subnet.id,
          cidr: r.subnet.cidr,
          gateway: r.subnet.gateway,
          dnsServers: r.subnet.dnsServers
            ? r.subnet.dnsServers.split(',').map(s => s.trim()).filter(Boolean)
            : [],
        })
      }
    }

    type Choice =
      | { kind: "vnet"; name: string; displayName: string; vdc: string; vdcId: string | null; zone: string; subnet: SubnetInfo | null }
      | { kind: "shared"; name: string; label: string | null }
      | { kind: "bridge"; name: string; type: string }

    const choices: Choice[] = []

    if (scope === null) {
      // Super admin or tenant without vDC - return all physical bridges + all VNets
      const ifaces = await pveFetch<any[]>(pveConn, `/nodes/${encodeURIComponent(node)}/network`)
      for (const ifc of ifaces || []) {
        if (ifc.type !== "bridge" && ifc.type !== "OVSBridge") continue
        choices.push({ kind: "bridge", name: ifc.iface, type: ifc.type })
      }
      try {
        const vnets = await pveFetch<any[]>(pveConn, "/cluster/sdn/vnets")
        for (const v of vnets || []) {
          // PVE returns alias when set (we set it to display_name on create);
          // fall back to the bare ID for legacy/externally-managed VNets.
          choices.push({
            kind: "vnet",
            name: v.vnet,
            displayName: v.alias ?? v.vnet,
            vdc: "*",
            // Super-admin (no scope filter) sees PVE VNets directly —
            // the matching ProxCenter vDC isn't always 1-to-1, so we
            // leave vdcId null. Endpoints that need a specific vDC
            // shouldn't be reachable via this path anyway.
            vdcId: null,
            zone: v.zone,
            subnet: subnetByPveName.get(v.vnet) ?? null,
          })
        }
      } catch {}
    } else {
      // Tenant with vDC(s) on this connection
      const allowedVnets = scope.vnetsByConnection.get(connId) ?? new Set<string>()
      const allowedShared = scope.sharedBridgesByConnection.get(connId) ?? new Set<string>()

      // VNets with vdc slug + zone. `name` stays the pve_name (= what PVE
      // expects in the NIC bridge field) but we expose displayName separately
      // so the picker can render the user-friendly label.
      const vnetRows = await prisma.vdcVnet.findMany({
        where: { vdc: { tenantId, connectionId: connId } },
        select: {
          pveName: true,
          displayName: true,
          vdc: { select: { id: true, slug: true, sdnZoneName: true } },
        },
      })
      for (const v of vnetRows) {
        if (allowedVnets.has(v.pveName)) {
          choices.push({
            kind: "vnet",
            name: v.pveName,
            displayName: v.displayName ?? v.pveName,
            vdc: v.vdc.slug,
            // Routes that hit /api/v1/vdcs/{id}/... need the UUID, not
            // the slug. Surface it explicitly so the deploy wizard
            // (and any future caller) doesn't have to do a second
            // lookup to translate slug → id.
            vdcId: v.vdc.id,
            zone: v.vdc.sdnZoneName ?? '',
            subnet: subnetByPveName.get(v.pveName) ?? null,
          })
        }
      }

      // Shared bridges with labels
      if (allowedShared.size > 0) {
        const sharedRows = await prisma.vdcSharedBridge.findMany({
          where: { vdc: { tenantId, connectionId: connId } },
          select: { bridge: true, label: true },
        })
        const labelMap = new Map<string, string | null>()
        for (const r of sharedRows) labelMap.set(r.bridge, r.label ?? null)
        for (const bridge of allowedShared) {
          choices.push({ kind: "shared", name: bridge, label: labelMap.get(bridge) ?? null })
        }
      }
    }

    return NextResponse.json({ data: choices })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
