import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { executeSSH } from "@/lib/ssh/exec"
import { getNodeIp } from "@/lib/ssh/node-ip"

export const runtime = "nodejs"

// In-memory screenshot cache: key = "connId:node:vmid", value = { data, timestamp }
const screenshotCache = new Map<string, { data: string; timestamp: number }>()
const CACHE_TTL = 5_000 // 5 seconds

// Cleanup old cache entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of screenshotCache) {
    if (now - val.timestamp > CACHE_TTL * 2) screenshotCache.delete(key)
  }
}, 30_000)

/**
 * GET /api/v1/connections/[id]/guests/[type]/[node]/[vmid]/screenshot
 * Captures a screenshot of a running QEMU VM via SSH.
 * Uses `qm monitor` to run screendump, then reads the PPM file back as base64.
 * Only works for QEMU VMs with SSH enabled on the connection.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> }
) {
  const { id, type, node, vmid } = await ctx.params

  // Only QEMU VMs have a framebuffer
  if (type !== 'qemu') {
    return NextResponse.json({ data: null, reason: 'lxc' })
  }

  // RBAC: Check vm.console permission
  const resourceId = buildVmResourceId(id, node, type, vmid)
  const denied = await checkPermission(PERMISSIONS.VM_CONSOLE, "vm", resourceId)

  if (denied) return denied

  // Check cache first
  const cacheKey = `${id}:${node}:${vmid}`
  const cached = screenshotCache.get(cacheKey)

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({ data: cached.data, format: 'ppm', cached: true })
  }

  const conn = await getConnectionById(id)

  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  try {
    const nodeIp = await getNodeIp(conn, node)
    const tmpFile = `/tmp/pxc-screen-${vmid}.ppm`

    // All via SSH as root: screendump through qm monitor, then read + encode + cleanup
    const sshResult = await executeSSH(
      conn.id,
      nodeIp,
      `qm monitor ${vmid} <<< 'screendump ${tmpFile}' > /dev/null 2>&1 && base64 -w0 ${tmpFile} && rm -f ${tmpFile}`
    )

    if (!sshResult.success || !sshResult.output) {
      return NextResponse.json({ data: null, reason: 'ssh_failed', error: sshResult.error })
    }

    // Cache the result
    const b64Data = sshResult.output.trim()
    screenshotCache.set(cacheKey, { data: b64Data, timestamp: Date.now() })

    return NextResponse.json({ data: b64Data, format: 'ppm' })
  } catch (e: any) {
    return NextResponse.json({ data: null, reason: 'error', error: e?.message || String(e) })
  }
}
