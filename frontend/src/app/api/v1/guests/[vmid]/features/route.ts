import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionByIdOrNull } from "@/lib/connections/getConnection"
import { safeLog } from "@/lib/log/sanitize"

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

    const conn = await getConnectionByIdOrNull(connId)

    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const apiPath = `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/feature`
    const result = await pveFetch<any>(conn, `${apiPath}?feature=${encodeURIComponent(feature)}`)

    return NextResponse.json({
      data: { hasFeature: !!result?.hasFeature }
    })
  } catch (e: any) {
    console.error("Feature check error:", safeLog(e?.message))
    const status = /invalid vmkey/i.test(e?.message || "") ? 400 : 500
    return NextResponse.json({ error: e?.message || "Feature check failed" }, { status })
  }
}
