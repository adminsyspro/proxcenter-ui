import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { locateVmInCluster } from "@/lib/proxmox/locateVm"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { executeSSH } from "@/lib/ssh/exec"
import { getNodeIp } from "@/lib/ssh/node-ip"
import { assertNodeName, assertVmid, InvalidShellArgError } from "@/lib/ssh/validate"

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
  const { id, type, node: rawNode, vmid: rawVmid } = await ctx.params

  // Only QEMU VMs have a framebuffer
  if (type !== 'qemu') {
    return NextResponse.json({ data: null, reason: 'lxc' })
  }

  // Strictly validate URL segments before they flow into a shell command.
  let node: string
  let vmid: string

  try {
    node = assertNodeName(rawNode)
    vmid = assertVmid(rawVmid)
  } catch (e) {
    if (e instanceof InvalidShellArgError) {
      return NextResponse.json({ data: null, reason: 'invalid_args', error: e.message }, { status: 400 })
    }

    throw e
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
    const tmpFile = `/tmp/pxc-screen-${vmid}.ppm`
    const cmd = `qm monitor ${vmid} <<< 'screendump ${tmpFile}' > /dev/null 2>&1 && base64 -w0 ${tmpFile} && rm -f ${tmpFile}`

    // Try the originally-requested node first.
    let resolvedNode = node
    let movedTo: string | null = null
    let nodeIp = await getNodeIp(conn, resolvedNode)
    let sshResult = await executeSSH(conn.id, nodeIp, cmd)

    // qm monitor exits with status 2 when the VM is not on this node — most
    // common cause: an intra-cluster migration moved the VM and our caller
    // is still holding the stale source node. Re-resolve via /cluster/resources
    // and retry once before surfacing the failure.
    if (!sshResult.success) {
      const located = await locateVmInCluster(conn, vmid, "qemu")

      if (located && located.node !== resolvedNode) {
        resolvedNode = located.node
        movedTo = located.node
        nodeIp = await getNodeIp(conn, resolvedNode)
        sshResult = await executeSSH(conn.id, nodeIp, cmd)
      }
    }

    if (!sshResult.success || !sshResult.output) {
      return NextResponse.json({ data: null, reason: 'ssh_failed', error: sshResult.error, movedTo })
    }

    // Cache the result under the resolved node so subsequent calls coming
    // through the stale node URL still hit the cache.
    const b64Data = sshResult.output.trim()

    screenshotCache.set(`${id}:${resolvedNode}:${vmid}`, { data: b64Data, timestamp: Date.now() })

    if (resolvedNode !== node) {
      screenshotCache.set(cacheKey, { data: b64Data, timestamp: Date.now() })
    }

    return NextResponse.json({ data: b64Data, format: 'ppm', movedTo })
  } catch (e: any) {
    return NextResponse.json({ data: null, reason: 'error', error: e?.message || String(e) })
  }
}
