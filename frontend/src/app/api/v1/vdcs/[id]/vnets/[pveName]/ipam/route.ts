import { NextResponse } from "next/server"

import { getCurrentTenantId } from "@/lib/tenant"
import { checkPermission } from "@/lib/rbac"
import { prisma } from "@/lib/db/prisma"
import { listAllocationsForSubnet } from "@/lib/vdc/ipam"
import { parseCidr } from "@/lib/vdc/network"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"

export const runtime = "nodejs"

// GET /api/v1/vdcs/{id}/vnets/{displayName}/ipam
//
// Lists every IPAM allocation tied to the VNet's subnet, plus a small
// usage summary so the panel can show "X / Y allocated" without a second
// round-trip. Tenant-scoped (the JOIN on tenant_id keeps tenants from
// peeking at other vDCs).
type RouteContext = { params: Promise<{ id: string; pveName: string }> | { id: string; pveName: string } }

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const params = await Promise.resolve(ctx.params)
    const vdcId = (params as any)?.id
    const displayName = (params as any)?.pveName

    if (!vdcId || !displayName) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 })
    }

    const denied = await checkPermission("sdn.vnet.view")

    if (denied) return denied

    const tenantId = await getCurrentTenantId()

    // Resolve the VNet → subnet, scoped to the caller's tenant. We pull
    // both rows in one query so we can fail-fast on a missing/foreign vDC.
    const vnetRow = await prisma.vdcVnet.findFirst({
      where: { vdcId, displayName, vdc: { tenantId } },
      select: {
        subnet: { select: { id: true, cidr: true, gateway: true } },
        vdc: { select: { connectionId: true } },
      },
    })

    if (!vnetRow || !vnetRow.subnet) return NextResponse.json({ error: "VNet not found" }, { status: 404 })

    const row = {
      subnet_id: vnetRow.subnet.id,
      cidr: vnetRow.subnet.cidr,
      gateway: vnetRow.subnet.gateway,
      connection_id: vnetRow.vdc.connectionId,
    }

    const allocations = await listAllocationsForSubnet(row.subnet_id)

    // Enrich each allocation with the live PVE state (name, node, status,
    // type). This lets the frontend show an icon + status pastille without
    // a second round-trip per row. /cluster/resources is the canonical
    // place to get all of those at once. If the lookup fails (provider
    // connection unreachable, RBAC, transient PVE error) we degrade
    // gracefully and return the IPAM rows alone — the IP/MAC are still
    // useful even without the live state.
    const vmIndex = new Map<number, { name: string; node: string; status: string; type: string }>()

    try {
      const connMeta = await prisma.connection.findUnique({
        where: { id: row.connection_id },
        select: { tenantId: true },
      })

      if (connMeta) {
        const conn = await getConnectionById(row.connection_id, connMeta.tenantId)
        const resources = await pveFetch<any[]>(conn, '/cluster/resources?type=vm')

        for (const r of resources ?? []) {
          // PVE returns vmid as a number on /cluster/resources, but be
          // defensive: some older versions / proxies stringify it. Always
          // normalise to Number so the Map lookup matches the IPAM row's
          // numeric vmid.
          const vmidNum = Number(r?.vmid)

          if (!Number.isFinite(vmidNum)) continue
          vmIndex.set(vmidNum, {
            name: String(r.name ?? `vm-${vmidNum}`),
            node: String(r.node ?? ''),
            status: String(r.status ?? 'unknown'),
            type: String(r.type ?? 'qemu'),
          })
        }
      }
    } catch {
      // Live PVE state is best-effort enrichment; the IPAM rows themselves
      // are still useful (IP/MAC/vmid/hostname) when the cluster lookup fails.
    }

    // Usable = CIDR usable hosts minus the gateway. The IPAM allocates the
    // entire usable range; tenants who want to reserve some IPs for hand-
    // managed appliances declare a smaller CIDR.
    const parsed = parseCidr(row.cidr)
    let usable = 0

    if (parsed) {
      const low = parsed.firstUsableInt
      const high = parsed.lastUsableInt
      const gatewayInt = parseCidr(`${row.gateway}/32`)?.networkInt
      const gatewayInRange = typeof gatewayInt === 'number' && gatewayInt >= low && gatewayInt <= high

      usable = Math.max(0, high - low + 1 - (gatewayInRange ? 1 : 0))
    }

    return NextResponse.json({
      data: {
        connectionId: row.connection_id,
        subnetId: row.subnet_id,
        cidr: row.cidr,
        gateway: row.gateway,
        usable,
        used: allocations.length,
        allocations: allocations.map((a) => {
          const vm = a.vmid != null ? vmIndex.get(a.vmid) ?? null : null


return {
            id: a.id,
            ip: a.ip,
            mac: a.mac,
            vmid: a.vmid,
            hostname: a.hostname,
            createdAt: a.createdAt,
            vm,
          }
        }),
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
