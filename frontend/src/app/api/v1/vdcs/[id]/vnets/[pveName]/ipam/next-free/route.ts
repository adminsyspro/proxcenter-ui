// Pre-allocation preview endpoint: returns the next free IP in the VNet's
// subnet WITHOUT writing anything to the IPAM. Used by the deploy wizard
// (ISO branch) to pre-fill the network-reservation step before the tenant
// commits to the deploy. The actual reservation happens at deploy time
// via allocateIp(hint=...).

import { NextResponse } from "next/server"

import { getCurrentTenantId } from "@/lib/tenant"
import { checkPermission } from "@/lib/rbac"
import { listAllocationsForSubnet } from "@/lib/vdc/ipam"
import { scanUsedIpsForSubnet, scannedToIntSet } from "@/lib/vdc/ipamScan"
import { generatePveMacAddress } from "@/lib/vdc/sdn"
import { parseCidr, ipToInt, intToIp } from "@/lib/vdc/network"
import { getConnectionById } from "@/lib/connections/getConnection"
import { prisma } from "@/lib/db/prisma"

export const runtime = "nodejs"

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

    const vnetRow = await prisma.vdcVnet.findFirst({
      where: { vdcId, displayName, vdc: { tenantId } },
      select: {
        pveName: true,
        subnet: { select: { id: true, cidr: true, gateway: true, dnsServers: true } },
        vdc: { select: { connectionId: true, pvePoolName: true } },
      },
    })

    if (!vnetRow || !vnetRow.subnet) return NextResponse.json({ error: "VNet not found" }, { status: 404 })

    const row = {
      subnet_id: vnetRow.subnet.id,
      cidr: vnetRow.subnet.cidr,
      gateway: vnetRow.subnet.gateway,
      dns_servers: vnetRow.subnet.dnsServers,
      vnet_pve_name: vnetRow.pveName,
      connection_id: vnetRow.vdc.connectionId,
      pve_pool_name: vnetRow.vdc.pvePoolName,
    }

    const parsed = parseCidr(row.cidr)

    if (!parsed) return NextResponse.json({ error: "Invalid CIDR" }, { status: 500 })

    // Build the union of "taken" IPs: IPAM-tracked rows + IPs deployed
    // out-of-band in PVE configs (CLI-created VMs, etc.). Mirrors the
    // exact set the allocator would build at deploy time so the preview
    // matches what the tenant will actually get.
    const taken = new Set<number>()

    const allocs = await listAllocationsForSubnet(row.subnet_id)

    for (const a of allocs) taken.add(a.ipInt)

    try {
      const connMeta = await prisma.connection.findUnique({
        where: { id: row.connection_id },
        select: { tenantId: true },
      })

      if (connMeta) {
        const conn = await getConnectionById(row.connection_id, connMeta.tenantId)

        const scanned = await scanUsedIpsForSubnet({
          conn,
          vdcPoolName: row.pve_pool_name,
          vnetPveName: row.vnet_pve_name,
          subnetId: row.subnet_id,
          connectionId: row.connection_id,
        })

        for (const n of scannedToIntSet(scanned)) taken.add(n)
      }
    } catch (err: any) {
      // Scan failure → fall back to IPAM-only view. Better to suggest a
      // best-effort IP than to fail the wizard step.
      console.warn(`[ipam-next-free] external scan failed: ${err?.message ?? err}`)
    }

    const gatewayInt = ipToInt(row.gateway)

    if (gatewayInt !== null) taken.add(gatewayInt)

    let firstFree: string | null = null

    for (let n = parsed.firstUsableInt; n <= parsed.lastUsableInt; n++) {
      if (!taken.has(n)) { firstFree = intToIp(n); break }
    }

    if (!firstFree) {
      return NextResponse.json({ error: "Subnet is full" }, { status: 409 })
    }

    return NextResponse.json({
      data: {
        ip: firstFree,
        cidr: row.cidr,
        prefix: parsed.prefix,
        gateway: row.gateway,
        dnsServers: row.dns_servers
          ? String(row.dns_servers).split(",").map((s) => s.trim()).filter(Boolean)
          : [],
        suggestedMac: generatePveMacAddress(),
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
