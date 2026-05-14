import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

type Params = {
  vmid: string // Format: connId:type:node:vmid
}

function parseVmKey(vmKey: string) {
  const parts = vmKey.split(':')

  if (parts.length !== 4) {
    throw new Error('Invalid vmKey format. Expected connId:type:node:vmid')
  }

  return {
    connId: parts[0],
    type: parts[1],
    node: parts[2],
    vmid: parts[3],
  }
}

async function getConnection(id: string) {
  // Use the shared helper so vDC tenants reach provider-owned connections
  // through their vDC scope instead of getting a tenant-scoped 404.
  try {
    return await getConnectionById(id)
  } catch {
    return null
  }
}

/**
 * GET /api/v1/guests/[vmid]/features?feature=snapshot
 * Check if a feature is available for a LXC container
 * Only applicable to LXC (VMs always support snapshots)
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<Params> }
) {
  try {
    const params = await ctx.params
    const { connId, type, node, vmid } = parseVmKey(params.vmid)

    const url = new URL(req.url)
    const feature = url.searchParams.get('feature')

    if (!feature) {
      return NextResponse.json({ error: "feature query param is required" }, { status: 400 })
    }

    // VMs (qemu) always support snapshots
    if (type !== 'lxc') {
      return NextResponse.json({ data: { hasFeature: true } })
    }

    const conn = await getConnection(connId)

    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const apiPath = `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/feature`
    const result = await pveFetch<any>(conn, `${apiPath}?feature=${encodeURIComponent(feature)}`)

    return NextResponse.json({
      data: { hasFeature: !!result?.hasFeature }
    })
  } catch (e: any) {
    console.error("Feature check error:", e?.message)

return NextResponse.json({ data: { hasFeature: false } })
  }
}
