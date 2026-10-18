import { NextResponse } from "next/server"

import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { getPrincipal, type Principal } from "@/lib/auth/principal"
import { getCurrentTenantId } from "@/lib/tenant"
import { listVnetsForTenant, createVnetForTenant } from "@/lib/vdc/vnets"
import { checkVnetPermission } from "@/lib/vdc/vnetPermission"
import { VniError } from "@/lib/vdc/vniPolicy"
import { getSubnetUsage } from "@/lib/vdc/ipam"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string }; principal?: Principal }

// GET /api/v1/vdcs/{id}/vnets
async function getHandler(_req: Request, ctx: RouteContext) {
  try {
    const params = await Promise.resolve(ctx.params)
    const vdcId = (params as any)?.id
    if (!vdcId) return NextResponse.json({ error: "Missing vDC ID" }, { status: 400 })

    const denied = await checkVnetPermission(ctx.principal, vdcId, "sdn.vnet.view")
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
/** DNS servers as an array or a comma-separated string; anything else = none. */
function parseDnsServers(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) return raw.map(x => String(x).trim()).filter(Boolean)
  if (typeof raw === "string") return raw.split(",").map(x => x.trim()).filter(Boolean)
  return undefined
}

async function postHandler(req: Request, ctx: RouteContext) {
  try {
    const params = await Promise.resolve(ctx.params)
    const vdcId = (params as any)?.id
    if (!vdcId) return NextResponse.json({ error: "Missing vDC ID" }, { status: 400 })

    const denied = await checkVnetPermission(ctx.principal, vdcId, "sdn.vnet.create")
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

    // Subnet is optional (roadmap#18): absent or null = pure L2 network, the
    // tenant brings its own addressing. Present = CIDR and gateway required.
    let subnet: { cidr: string; gateway: string; dnsServers?: string[] } | null = null
    if (body?.subnet !== undefined && body?.subnet !== null) {
      if (typeof body.subnet !== "object") {
        return NextResponse.json({ error: "subnet must be an object (cidr + gateway) or null for a pure L2 network" }, { status: 400 })
      }
      const s = body.subnet
      const cidr = typeof s.cidr === "string" ? s.cidr.trim() : ""
      const gateway = typeof s.gateway === "string" ? s.gateway.trim() : ""
      if (!cidr && !gateway && !s.dnsServers) {
        subnet = null
      } else {
        if (!cidr || !gateway) {
          return NextResponse.json({ error: "subnet.cidr and subnet.gateway are required when a subnet is given" }, { status: 400 })
        }
        subnet = { cidr, gateway, dnsServers: parseDnsServers(s.dnsServers) }
      }
    }
    // Tenant-chosen VNI (roadmap#18); the library validates it against the
    // transport policy and answers with the right status.
    const vni = body?.vni === undefined || body?.vni === null || body?.vni === '' ? null : body.vni

    const type = body?.type === 'vlan' ? 'vlan' as const : 'vxlan' as const
    const bridge = typeof body?.bridge === 'string' ? body.bridge.trim() : ''
    if (type === 'vlan' && !bridge) {
      return NextResponse.json({ error: 'bridge is required for a VLAN network' }, { status: 400 })
    }
    let vlanTag: number | null = null
    if (body?.vlanTag != null && body.vlanTag !== '') {
      vlanTag = Number(body.vlanTag)
      if (!Number.isInteger(vlanTag) || vlanTag < 1 || vlanTag > 4094) {
        return NextResponse.json({ error: 'vlanTag must be an integer between 1 and 4094' }, { status: 400 })
      }
    }
    const externalAddressing = body?.externalAddressing === true

    // A token creates as nobody: the audit journals the write under the token.
    const principal = ctx.principal ?? (await getPrincipal()).principal
    const createdBy = principal?.userId ?? null
    const tenantId = await getCurrentTenantId()

    try {
      const vnet = await createVnetForTenant({
        vdcId, tenantId, displayName, description, firewall, subnet, vni, createdBy,
        type, bridge: bridge || undefined, vlanTag, externalAddressing,
      })
      return NextResponse.json({ data: vnet }, { status: 201 })
    } catch (err: any) {
      const msg = err?.message || String(err)
      if (err instanceof VniError) return NextResponse.json({ error: msg }, { status: err.status })
      // A platform-provided edge needs the subnet (#904); vni on a VLAN network.
      if (msg.includes('define the subnet') || msg.includes('vni applies to VXLAN')) {
        return NextResponse.json({ error: msg }, { status: 400 })
      }
      if (msg.includes("Quota exceeded")) return NextResponse.json({ error: msg }, { status: 409 })
      if (msg.includes("Invalid VNet name")) return NextResponse.json({ error: msg }, { status: 400 })
      if (msg.includes('has no VLAN pool')) return NextResponse.json({ error: msg }, { status: 400 })
      if (msg.includes('outside the vDC pools')) return NextResponse.json({ error: msg }, { status: 400 })
      if (msg.includes('already in use on bridge')) return NextResponse.json({ error: msg }, { status: 409 })
      if (msg.includes('No free VLAN tag')) return NextResponse.json({ error: msg }, { status: 409 })
      if (msg.includes('bridge is required')) return NextResponse.json({ error: msg }, { status: 400 })
      // Pre-Phase-4a vDCs carry no SDN zone: a default (VXLAN) create on one
      // is a bad request, not a server fault.
      if (msg.includes('has no SDN zone')) return NextResponse.json({ error: msg }, { status: 400 })
      // Catches our own "VNet ... already exists" AND PVE's cross-zone
      // backstop ("tag 137 already exist in vnet ...", no trailing s).
      if (msg.includes('already exist')) return NextResponse.json({ error: msg }, { status: 409 })
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

export const GET = withPublicApiGuard("vdc-vnets-list", getHandler)
export const POST = withPublicApiGuard("vdc-vnet-create", postHandler)
