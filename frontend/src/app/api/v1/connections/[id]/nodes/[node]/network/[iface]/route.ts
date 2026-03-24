import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string; node: string; iface: string }> }

// GET /api/v1/connections/{id}/nodes/{node}/network/{iface}
export async function GET(req: Request, ctx: Ctx) {
  try {
    const { id, node, iface } = await ctx.params
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_NETWORK, "node", resourceId)
    if (denied) return denied

    const conn = await getConnectionById(id)
    const data = await pveFetch<any>(conn, `/nodes/${encodeURIComponent(node)}/network/${encodeURIComponent(iface)}`)

    return NextResponse.json({ data })
  } catch (e: any) {
    console.error('Error fetching network interface:', e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// PUT /api/v1/connections/{id}/nodes/{node}/network/{iface}
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const { id, node, iface } = await ctx.params
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_NETWORK, "node", resourceId)
    if (denied) return denied

    const conn = await getConnectionById(id)
    const body = await req.json()

    const params = new URLSearchParams()
    const type = body.type
    // Required field
    params.append('type', type)

    // Detect CIDR notation: if address contains '/', send as 'cidr' instead of 'address'+'netmask'
    const ipv4IsCidr = typeof body.address === 'string' && body.address.includes('/')
    const ipv6IsCidr = typeof body.address6 === 'string' && body.address6.includes('/')

    if (ipv4IsCidr) {
      body.cidr = body.address
      delete body.address
      delete body.netmask
    }
    if (ipv6IsCidr) {
      body.cidr6 = body.address6
      delete body.address6
      delete body.netmask6
    }

    // Common fields for all types
    const commonFields = [
      'address', 'netmask', 'gateway', 'address6', 'netmask6', 'gateway6',
      'cidr', 'cidr6', 'mtu', 'comments',
    ]

    // Type-specific fields
    // Note: bridge_stp and bridge_fd are NOT accepted by the PVE API PUT endpoint
    const bridgeFields = ['bridge_ports', 'bridge_vlan_aware']
    // PVE uses mixed naming: bond_mode (underscore), bond-primary (hyphen), bond_xmit_hash_policy (underscore)
    const bondFields = ['bond_mode', 'bond-primary', 'bond_xmit_hash_policy', 'slaves']
    const vlanFields = ['vlan-id', 'vlan-raw-device']
    const ovsFields = ['ovs_bridge', 'ovs_options', 'ovs_tag', 'ovs_bonds', 'ovs_ports']

    const isBridge = type === 'bridge' || type === 'OVSBridge'
    const isBond = type === 'bond' || type === 'OVSBond'
    const isVlan = type === 'vlan' || type === 'OVSIntPort'
    const isOvs = type?.startsWith('OVS')

    const fields = [
      ...commonFields,
      ...(isBridge ? bridgeFields : []),
      ...(isBond ? bondFields : []),
      ...(isVlan ? vlanFields : []),
      ...(isOvs ? ovsFields : []),
    ]

    // Boolean fields that PVE expects as 0/1
    const booleanFields = ['autostart', 'bridge_vlan_aware']

    // Handle autostart separately (always valid)
    if (body.autostart !== undefined) {
      params.append('autostart', body.autostart ? '1' : '0')
    }

    for (const f of fields) {
      if (body[f] === undefined || body[f] === '') continue
      if (booleanFields.includes(f)) {
        params.append(f, body[f] ? '1' : '0')
      } else {
        params.append(f, String(body[f]))
      }
    }

    await pveFetch(conn, `/nodes/${encodeURIComponent(node)}/network/${encodeURIComponent(iface)}`, {
      method: 'PUT',
      body: params,
    })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('Error updating network interface:', e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// DELETE /api/v1/connections/{id}/nodes/{node}/network/{iface}
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const { id, node, iface } = await ctx.params
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_NETWORK, "node", resourceId)
    if (denied) return denied

    const conn = await getConnectionById(id)

    await pveFetch(conn, `/nodes/${encodeURIComponent(node)}/network/${encodeURIComponent(iface)}`, {
      method: 'DELETE',
    })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('Error deleting network interface:', e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
