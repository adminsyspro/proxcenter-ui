import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET /api/v1/connections/{id}/nodes/{node}/network
// Récupère les interfaces réseau disponibles sur un node
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    // RBAC: Check node.network permission
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_NETWORK, "node", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    const networks = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(node)}/network`)

    return NextResponse.json({ data: networks || [] })
  } catch (e: any) {
    console.error('Error fetching network interfaces:', e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// POST /api/v1/connections/{id}/nodes/{node}/network
// Crée une nouvelle interface réseau sur le node
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_NETWORK, "node", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)
    const body = await req.json()

    const params = new URLSearchParams()

    params.append('iface', body.iface)
    params.append('type', body.type)

    const fields = [
      'address', 'netmask', 'gateway', 'address6', 'netmask6', 'gateway6',
      'cidr', 'cidr6', 'autostart', 'mtu', 'comments',
      'bridge_ports', 'bridge_stp', 'bridge_fd', 'bridge_vlan_aware',
      'bond_mode', 'bond_primary', 'bond-xmit-hash-policy', 'slaves',
      'vlan-id', 'vlan-raw-device',
      'ovs_bridge', 'ovs_options', 'ovs_tag', 'ovs_bonds', 'ovs_ports',
    ]

    for (const f of fields) {
      if (body[f] !== undefined && body[f] !== '') {
        params.append(f, String(body[f]))
      }
    }

    await pveFetch(conn, `/nodes/${encodeURIComponent(node)}/network`, {
      method: 'POST',
      body: params,
    })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('Error creating network interface:', e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// PUT /api/v1/connections/{id}/nodes/{node}/network
// Applique la configuration réseau (ifreload)
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_NETWORK, "node", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    await pveFetch(conn, `/nodes/${encodeURIComponent(node)}/network`, {
      method: 'PUT',
    })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('Error applying network config:', e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// DELETE /api/v1/connections/{id}/nodes/{node}/network
// Revert les changements réseau en attente
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_NETWORK, "node", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    await pveFetch(conn, `/nodes/${encodeURIComponent(node)}/network`, {
      method: 'DELETE',
    })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('Error reverting network config:', e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
