import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { ppmToJpeg } from "@/lib/console/ppm"
import { pveFetch } from "@/lib/proxmox/client"
import { locateVmInCluster } from "@/lib/proxmox/locateVm"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { executeSSH } from "@/lib/ssh/exec"
import { assertVmid } from "@/lib/ssh/validate"
import { getNodeIp } from "@/lib/ssh/node-ip"

export const runtime = "nodejs"

// In-memory screenshot cache: key = "connId:node:vmid", value = { jpeg, timestamp }.
// We cache the already-encoded JPEG (not the raw PPM) so cache hits are served
// without re-running the PPM->JPEG conversion.
const screenshotCache = new Map<string, { jpeg: Buffer; timestamp: number }>()
const CACHE_TTL = 5_000 // 5 seconds

// Whether a VM has a graphical framebuffer (vga != serial/none), cached so the
// per-poll path doesn't re-fetch the VM config every 10s. Display config almost
// never changes at runtime, so a 60s TTL is ample. key = "connId:node:vmid".
const hasFramebufferCache = new Map<string, { value: boolean; timestamp: number }>()
const FRAMEBUFFER_TTL = 60_000 // 60 seconds

// Drop cache entries older than twice their TTL. Exported so the periodic
// cleanup below can be exercised deterministically in tests (the 30s interval
// itself never fires under Vitest). `now` is injectable for the same reason.
export function pruneScreenshotCaches(now: number = Date.now()): void {
  for (const [key, val] of screenshotCache) {
    if (now - val.timestamp > CACHE_TTL * 2) screenshotCache.delete(key)
  }
  for (const [key, val] of hasFramebufferCache) {
    if (now - val.timestamp > FRAMEBUFFER_TTL * 2) hasFramebufferCache.delete(key)
  }
}

// Cleanup old cache entries periodically
setInterval(() => pruneScreenshotCaches(), 30_000)

// Serve an encoded frame as a binary image/jpeg response. Returning a real
// image (rather than a base64 PPM wrapped in JSON) is what keeps each poll at
// ~100 KB instead of multiple MB of uncompressed bitmap.
function jpegResponse(jpeg: Buffer, extraHeaders?: Record<string, string>): NextResponse {
  return new NextResponse(new Uint8Array(jpeg), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      // Live frame: never let a cache hand back a stale screen. The 5s in-memory
      // cache above already de-dupes bursts on the server side.
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  })
}

/**
 * GET /api/v1/connections/[id]/guests/[type]/[node]/[vmid]/screenshot
 * Captures a screenshot of a running QEMU VM via SSH.
 * Uses `qm monitor` to run screendump, reads the PPM file back as base64, then
 * re-encodes it to JPEG server-side and returns a binary `image/jpeg` body.
 * Non-capture outcomes (lxc, no_display, ssh_failed, ...) are returned as JSON.
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

  // Constrain the VMID to a positive integer before it reaches the
  // `qm monitor ... ${vmid}` / `${tmpFile}` shell command run on the node.
  let safeVmid: string
  try {
    safeVmid = assertVmid(vmid)
  } catch {
    return NextResponse.json({ data: null, reason: 'invalid_vmid' }, { status: 400 })
  }

  // RBAC: Check vm.console permission
  const resourceId = buildVmResourceId(id, node, type, vmid)
  const denied = await checkPermission(PERMISSIONS.VM_CONSOLE, "vm", resourceId)

  if (denied) return denied

  // Check cache first
  const cacheKey = `${id}:${node}:${vmid}`
  const cached = screenshotCache.get(cacheKey)

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return jpegResponse(cached.jpeg, { "X-Screenshot-Cache": "hit" })
  }

  const conn = await getConnectionById(id)

  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  // Serial-only / headless VMs (vga: serial0, none, or GPU passthrough) have
  // no graphical framebuffer, so `qm monitor ... screendump` always fails with
  // "There is no console to take a screendump from" — no PPM is written and the
  // command exits non-zero. Detect that up front and skip the guaranteed-failing
  // SSH: otherwise the 10s client poll spams the orchestrator ERR log forever
  // and the UI shows a perpetually-black frame. The client uses reason=no_display
  // to render a "serial console" badge and stop polling. The VM config lives in
  // the shared cluster FS, so any reachable node answers regardless of placement.
  const fbKey = `${id}:${node}:${vmid}`
  const fbCached = hasFramebufferCache.get(fbKey)
  if (fbCached && Date.now() - fbCached.timestamp < FRAMEBUFFER_TTL) {
    if (!fbCached.value) return NextResponse.json({ data: null, reason: "no_display" })
  } else {
    try {
      const cfg = await pveFetch<{ vga?: string }>(
        conn,
        `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/config`
      )
      const vga = String(cfg?.vga || "").toLowerCase().trim()
      const hasFramebuffer = !(vga.startsWith("serial") || vga === "none")
      hasFramebufferCache.set(fbKey, { value: hasFramebuffer, timestamp: Date.now() })
      if (!hasFramebuffer) return NextResponse.json({ data: null, reason: "no_display" })
    } catch {
      // Config probe failed (node transiently down, etc.) — fall through to the
      // normal screendump path rather than hiding a VM that may be capturable.
    }
  }

  try {
    const tmpFile = `/tmp/pxc-screen-${safeVmid}.ppm`
    const cmd = `qm monitor ${safeVmid} <<< 'screendump ${tmpFile}' > /dev/null 2>&1 && base64 -w0 ${tmpFile} && rm -f ${tmpFile}`

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
      const located = await locateVmInCluster(conn, safeVmid, "qemu")
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

    // The node returns the framebuffer as a base64-encoded PPM (raw RGB bitmap).
    // Re-encode it to JPEG here so the browser-facing payload is ~100 KB instead
    // of several MB. A malformed/partial capture decodes to null — surface that
    // as JSON so the client treats it like any other transient failure.
    const ppmBuffer = Buffer.from(sshResult.output.trim(), "base64")
    const jpeg = ppmToJpeg(ppmBuffer)
    if (!jpeg) {
      return NextResponse.json({ data: null, reason: "decode_failed", movedTo })
    }

    // Cache the encoded frame under the resolved node so subsequent calls coming
    // through the stale node URL still hit the cache.
    const now = Date.now()
    screenshotCache.set(`${id}:${resolvedNode}:${vmid}`, { jpeg, timestamp: now })
    if (resolvedNode !== node) {
      screenshotCache.set(cacheKey, { jpeg, timestamp: now })
    }

    return jpegResponse(jpeg, movedTo ? { "X-Screenshot-Moved-To": movedTo } : undefined)
  } catch (e: any) {
    return NextResponse.json({ data: null, reason: 'error', error: e?.message || String(e) })
  }
}
