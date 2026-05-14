import { NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { getCurrentTenantId } from "@/lib/tenant"
import { checkPermission } from "@/lib/rbac"
import { listVnetsForTenant, createVnetForTenant } from "@/lib/vdc/vnets"
import { getSubnetUsage } from "@/lib/vdc/ipam"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

// GET /api/v1/vdcs/{id}/vnets
export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const params = await Promise.resolve(ctx.params)
    const vdcId = (params as any)?.id

    if (!vdcId) return NextResponse.json({ error: "Missing vDC ID" }, { status: 400 })

    const denied = await checkPermission("sdn.vnet.view")

    if (denied) return denied

    // Enrich each VNet with its IPAM usage counts so the dashboard can
    // render "used / usable" without an extra round-trip per row. The
    // count is a single COUNT(*) per VNet — cheaper than the per-row
    // /ipam endpoint and runs in the same DB connection.
    const vnets = await Promise.all((await listVnetsForTenant(vdcId)).map(async (v) => {
      const sn = v.subnet

      const ipamUsage = sn
        ? await getSubnetUsage(sn.id, sn.cidr, sn.gateway)
        : { used: 0, usable: 0 }


return { ...v, ipamUsage }
    }))


return NextResponse.json({ data: vnets })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// POST /api/v1/vdcs/{id}/vnets
export async function POST(req: Request, ctx: RouteContext) {
  try {
    const params = await Promise.resolve(ctx.params)
    const vdcId = (params as any)?.id

    if (!vdcId) return NextResponse.json({ error: "Missing vDC ID" }, { status: 400 })

    const denied = await checkPermission("sdn.vnet.create")

    if (denied) return denied

    const body = await req.json().catch(() => ({}))


    // Accept `displayName` (current), fall back to legacy `pveName` field
    // posted by older clients/dialogs that haven't been redeployed yet.
    const displayName = typeof body?.displayName === "string"
      ? body.displayName.trim()
      : typeof body?.pveName === "string"
        ? body.pveName.trim()
        : ""

    const description = typeof body?.description === "string" ? body.description.trim() : undefined
    const firewall = body?.firewall !== false

    if (!displayName) return NextResponse.json({ error: "displayName required" }, { status: 400 })

    // Subnet is mandatory — VNets without one cannot allocate IPs since
    // PVE-native IPAM/DHCP are broken on VXLAN zones.
    if (!body?.subnet || typeof body.subnet !== "object") {
      return NextResponse.json({ error: "subnet (cidr + gateway) is required" }, { status: 400 })
    }

    const s = body.subnet
    const cidr = typeof s.cidr === "string" ? s.cidr.trim() : ""
    const gateway = typeof s.gateway === "string" ? s.gateway.trim() : ""

    if (!cidr || !gateway) {
      return NextResponse.json({ error: "subnet.cidr and subnet.gateway are required" }, { status: 400 })
    }

    const dnsServers = Array.isArray(s.dnsServers)
      ? s.dnsServers.map((x: any) => String(x).trim()).filter(Boolean)
      : typeof s.dnsServers === "string"
        ? s.dnsServers.split(",").map((x: string) => x.trim()).filter(Boolean)
        : undefined

    const subnet = { cidr, gateway, dnsServers }

    const session = await getServerSession(authOptions)
    const createdBy = session?.user?.id ?? null
    const tenantId = await getCurrentTenantId()

    try {
      const vnet = await createVnetForTenant({ vdcId, tenantId, displayName, description, firewall, subnet, createdBy })


return NextResponse.json({ data: vnet }, { status: 201 })
    } catch (err: any) {
      const msg = err?.message || String(err)

      if (msg.includes("Quota exceeded")) return NextResponse.json({ error: msg }, { status: 409 })
      if (msg.includes("already exists")) return NextResponse.json({ error: msg }, { status: 409 })
      if (msg.includes("Invalid VNet name")) return NextResponse.json({ error: msg }, { status: 400 })

      // Subnet validation surfaces with these prefixes — all user input issues.
      if (
        msg.startsWith("Invalid CIDR") ||
        msg.startsWith("Gateway ")
      ) return NextResponse.json({ error: msg }, { status: 400 })
      if (msg.includes("vDC not found")) return NextResponse.json({ error: msg }, { status: 404 })
      throw err
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
