import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { prisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

/** Interface kinds that can carry a transport VLAN. */
const DEVICE_TYPES = new Set(["eth", "bond", "bridge", "OVSBridge", "OVSBond"])

function stripPrefix(cidr: unknown): string | null {
  const s = String(cidr ?? "").trim()
  if (!s) return null
  const slash = s.indexOf("/")
  return slash > 0 ? s.slice(0, slash) : s
}

// GET /api/v1/admin/connections/{id}/node-addresses
// Per node: the addresses its interfaces carry and the interfaces that can
// host a VLAN, plus the devices present on every online node (#899). Feeds
// the vDC dialog's transport section: peer-list warnings, device suggestions
// and the node -> address table.
export async function GET(_req: Request, ctx: RouteContext) {
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

    const nodesRaw = (await pveFetch<any[]>(conn, "/nodes")) || []

    // The corosync link address of each node: this is the peer a cluster-mode
    // zone gets, reported even for an offline node.
    const clusterIps = new Map<string, string>()
    try {
      for (const e of (await pveFetch<any[]>(conn, "/cluster/status")) || []) {
        if (e?.type === "node" && e?.name && e?.ip) clusterIps.set(String(e.name), String(e.ip))
      }
    } catch {
      // A standalone node or an unreachable cluster status: the UI falls back
      // to the first configured address.
    }

    const nodes = await Promise.all(
      nodesRaw
        .map((n: any) => ({
          name: String(n?.node ?? ""),
          online: String(n?.status).toLowerCase() === "online",
          clusterIp: clusterIps.get(String(n?.node ?? "")) ?? null,
        }))
        .filter((n) => n.name)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(async (n) => {
          if (!n.online) return { ...n, addresses: [] as string[], ifaces: [] as any[] }
          let raw: any[] = []
          try {
            raw = (await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(n.name)}/network`)) || []
          } catch {
            // An unreachable node still appears, with nothing to offer.
          }
          const addresses = new Set<string>()
          for (const i of raw) {
            for (const key of ["cidr", "cidr6", "address", "address6"]) {
              const ip = stripPrefix(i?.[key])
              if (ip) addresses.add(ip)
            }
          }
          const ifaces = raw
            .filter((i: any) => i?.iface && DEVICE_TYPES.has(String(i.type)))
            .map((i: any) => ({
              iface: String(i.iface),
              type: String(i.type),
              mtu: i.mtu ? Number(i.mtu) : null,
              cidr: i.cidr ? String(i.cidr) : null,
            }))
            .sort((a: any, b: any) => a.iface.localeCompare(b.iface))
          return { ...n, addresses: [...addresses], ifaces }
        }),
    )

    const online = nodes.filter((n) => n.online && n.ifaces.length > 0)
    let devices: string[] = []
    if (online.length > 0) {
      devices = online[0].ifaces.map((i: any) => i.iface)
      for (const n of online.slice(1)) {
        const names = new Set(n.ifaces.map((i: any) => i.iface))
        devices = devices.filter((d) => names.has(d))
      }
    }

    return NextResponse.json({ data: { nodes, devices } })
  } catch (e: any) {
    console.error("Error fetching node addresses:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 })
  }
}
