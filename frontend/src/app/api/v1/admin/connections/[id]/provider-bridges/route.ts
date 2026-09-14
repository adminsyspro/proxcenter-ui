import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { prisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

// GET /api/v1/admin/connections/{id}/provider-bridges
// Returns bridges AND provider-managed SDN VNets available on the cluster.
// Physical bridges are deduplicated across nodes. SDN VNets carry `type: 'sdn-vnet'`
// so the UI can tell them apart from host bridges.
// `?scope=vlan-pool` switches to the VLAN-pool picker's needs: zone uplink bridges are
// kept (only vnet names are excluded) and each bridge carries a `vlanAware` flag.
export async function GET(req: Request, ctx: RouteContext) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing connection ID" }, { status: 400 })

    const providerGate = await requireProviderTenant()
    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const connMeta = await prisma.connection.findUnique({ where: { id }, select: { tenantId: true } })
    if (!connMeta) return NextResponse.json({ error: "Connection not found" }, { status: 404 })

    const conn = await getConnectionById(id, connMeta.tenantId)

    const url = new URL(req.url)
    const scope = url.searchParams.get("scope")
    const forVlanPool = scope === "vlan-pool"

    // SDN zone uplink bridges are excluded from the host-bridge list so they
    // don't appear twice. Provider-managed VNets (whose zone is NOT assigned
    // to any vDC on this connection) are returned as `type: 'sdn-vnet'` so the
    // UI can offer them as shared uplinks. Tenant VNets (zone = a vDC's
    // sdnZoneName) are excluded: they are already the tenant's own networks.
    const sdnZoneBridges: Set<string> = new Set()
    const sdnVnetNames: Set<string> = new Set()
    type SdnVnetEntry = {
      iface: string; type: 'sdn-vnet'; zone: string; tag?: number; alias?: string
    }
    const sdnVnets: SdnVnetEntry[] = []
    try {
      const zones = await pveFetch<any[]>(conn, "/cluster/sdn/zones") || []
      if (!forVlanPool) {
        for (const z of zones) {
          if (z.bridge) sdnZoneBridges.add(String(z.bridge))
        }
      }

      const tenantZones = new Set(
        (await prisma.vdc.findMany({
          where: { connectionId: id, sdnZoneName: { not: null } },
          select: { sdnZoneName: true },
        })).map(r => r.sdnZoneName!),
      )

      const tenantVnetNames = new Set(
        (await prisma.vdcVnet.findMany({
          where: { vdc: { connectionId: id } },
          select: { pveName: true },
        })).map(r => r.pveName),
      )

      const vnets = await pveFetch<any[]>(conn, "/cluster/sdn/vnets") || []
      for (const v of vnets) {
        if (!v.vnet) continue
        sdnVnetNames.add(String(v.vnet))
        if (!forVlanPool && !tenantZones.has(String(v.zone ?? '')) && !tenantVnetNames.has(String(v.vnet))) {
          sdnVnets.push({
            iface: String(v.vnet),
            type: 'sdn-vnet',
            zone: String(v.zone ?? ''),
            tag: typeof v.tag === 'number' ? v.tag : undefined,
            alias: typeof v.alias === 'string' ? v.alias : undefined,
          })
        }
      }
    } catch (err: any) {
      console.warn(`[provider-bridges] Failed to fetch SDN config: ${err?.message}`)
    }
    const sdnExclude = new Set([...sdnZoneBridges, ...sdnVnetNames])

    // Gather bridges from all nodes, deduplicate by iface name
    const nodesRaw = await pveFetch<any[]>(conn, "/nodes") || []
    const bridgeMap = new Map<
      string,
      { iface: string; nodes: string[]; type: string; active?: number; comments?: string; vlanAware?: boolean }
    >()

    for (const n of nodesRaw) {
      const nodeName = n.node
      if (!nodeName) continue

      try {
        const ifaces = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/network`) || []
        for (const ifc of ifaces) {
          if (ifc.type !== "bridge" && ifc.type !== "OVSBridge") continue
          if (sdnExclude.has(ifc.iface)) continue

          const existing = bridgeMap.get(ifc.iface)
          if (existing) {
            existing.nodes.push(nodeName)
            if (forVlanPool) existing.vlanAware = existing.vlanAware || !!ifc.bridge_vlan_aware
          } else {
            bridgeMap.set(ifc.iface, {
              iface: ifc.iface,
              nodes: [nodeName],
              type: ifc.type,
              active: ifc.active,
              comments: ifc.comments,
              ...(forVlanPool ? { vlanAware: !!ifc.bridge_vlan_aware } : {}),
            })
          }
        }
      } catch (err: any) {
        console.warn(`[provider-bridges] Failed to list ${nodeName}/network: ${err?.message}`)
      }
    }

    const bridges = Array.from(bridgeMap.values()).sort((a, b) => a.iface.localeCompare(b.iface))
    const sdnSorted = sdnVnets.sort((a, b) => a.iface.localeCompare(b.iface))
    return NextResponse.json({ data: [...bridges, ...sdnSorted] })
  } catch (e: any) {
    console.error("[provider-bridges] error:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
