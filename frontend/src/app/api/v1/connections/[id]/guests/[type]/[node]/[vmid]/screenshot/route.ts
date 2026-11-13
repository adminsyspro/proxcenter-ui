import { NextResponse } from "next/server"
import { asRoot } from "@/lib/ssh/sudo"

import { getConnectionById } from "@/lib/connections/getConnection"
import { ppmToJpeg } from "@/lib/console/ppm"
import { pveFetch } from "@/lib/proxmox/client"
import { locateVmInCluster } from "@/lib/proxmox/locateVm"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { safeLog } from "@/lib/log/sanitize"
import { executeSSH } from "@/lib/ssh/exec"
import { assertVmid } from "@/lib/ssh/validate"
import { resolveNodeSshEndpoint } from "@/lib/ssh/node-endpoint"
import { guardSessionGuest } from "@/lib/vdc/guestGuard"

export const runtime = "nodejs"

// In-memory screenshot cache: key = "connId:node:vmid", value = { jpeg, timestamp, node }.
// We cache the already-encoded JPEG (not the raw PPM) so cache hits are served
// without re-running the PPM->JPEG conversion. `node` is the node the frame was
// captured on, which differs from the key's when the VM had moved.
const screenshotCache = new Map<string, { jpeg: Buffer; timestamp: number; node: string }>()
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

// The answer of a capture that did not happen. A VM found on a node the
// caller holds no vm.console on gets it too, so the reply does not tell the
// caller where the VM runs (roadmap#223).
const NOT_CAPTURED = { data: null, reason: 'ssh_failed', movedTo: null }

/** Whether the caller holds vm.console on `node`, the node a frame was or will be captured on. */
async function consoleCovers(id: string, node: string, type: string, vmid: string): Promise<boolean> {
  return !(await checkPermission(PERMISSIONS.VM_CONSOLE, "vm", buildVmResourceId(id, node, type, vmid)))
}

type Connection = NonNullable<Awaited<ReturnType<typeof getConnectionById>>>
type Capture = { ssh: Awaited<ReturnType<typeof executeSSH>>; node: string; movedTo: string | null }

/**
 * The monitor call fails when the VM is not on the URL node — most common
 * cause: an intra-cluster migration moved the VM and the caller still holds
 * the stale source node. Re-resolve it via /cluster/resources and retry once
 * there. vm.console was checked on the URL node: the node the VM runs on must
 * be covered too, as the config route does; null when it is not (roadmap#223).
 */
async function captureOnLocatedNode(conn: Connection, id: string, type: string, vmid: string, cmd: string, first: Capture): Promise<Capture | null> {
  const located = await locateVmInCluster(conn, vmid, "qemu")
  if (!located || located.node === first.node) return first
  if (!(await consoleCovers(id, located.node, type, vmid))) return null
  const nodeIp = await resolveNodeSshEndpoint(conn, located.node)
  return { ssh: await executeSSH(conn.id, nodeIp, cmd, undefined, { readOnly: true }), node: located.node, movedTo: located.node }
}

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

  const conn = await getConnectionById(id)

  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  // Before the cache lookup: a frame another operator captured seconds ago
  // must not be served to a vDC session whose guest this is not. The guest
  // may sit on another vDC node than the URL says (moved-node retry below).
  const scopeDenied = await guardSessionGuest({ connectionId: id, conn, type, node, vmid, allowMovedNode: true })
  if (scopeDenied) return scopeDenied

  // Check cache first
  const cacheKey = `${id}:${node}:${vmid}`
  const cached = screenshotCache.get(cacheKey)

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    // A frame captured on another node than the URL's: vm.console must cover
    // that node too, as on the capture itself (roadmap#223).
    if (cached.node !== node && !(await consoleCovers(id, cached.node, type, vmid))) {
      return NextResponse.json(NOT_CAPTURED)
    }
    return jpegResponse(cached.jpeg, { "X-Screenshot-Cache": "hit" })
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
    // The monitor command is an argument of pvesh, not stdin of `qm monitor`:
    // a sudoers rule can pin an argument, and the here-string `<<<` did not
    // exist in the /bin/sh (dash) that `sudo sh -c` runs, so no screenshot
    // ever came back for a sudo account. QEMU writes the file as root, so its
    // reading and removal are privileged too (0640 root:root); the EXIT trap
    // removes it on every outcome.
    const cmd = `trap '${asRoot(`rm -f ${tmpFile}`)}' EXIT; ${asRoot(`pvesh create /nodes/localhost/qemu/${safeVmid}/monitor --command 'screendump ${tmpFile}'`)} > /dev/null 2>&1 && ${asRoot(`base64 -w0 ${tmpFile}`)}`
    // The screendump only reads the guest's framebuffer, through a scratch
    // file the same command removes: a cluster outside the license stays
    // visible, pictures included (roadmap#58).
    const readOnly = { readOnly: true }

    // Try the originally-requested node first, then the node the VM runs on.
    let capture: Capture | null = { ssh: await executeSSH(conn.id, await resolveNodeSshEndpoint(conn, node), cmd, undefined, readOnly), node, movedTo: null }
    if (!capture.ssh.success) capture = await captureOnLocatedNode(conn, id, type, safeVmid, cmd, capture)
    if (!capture) return NextResponse.json(NOT_CAPTURED)
    const { ssh: sshResult, node: resolvedNode, movedTo } = capture

    if (!sshResult.success || !sshResult.output) {
      // The SSH error names the host and port the connection reaches: it
      // stays in the server log, the caller gets the reason code (roadmap#99).
      if (sshResult.error) console.error(`[screenshot] SSH failed on ${safeLog(resolvedNode)}:`, safeLog(sshResult.error))
      return NextResponse.json({ ...NOT_CAPTURED, movedTo })
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
    screenshotCache.set(`${id}:${resolvedNode}:${vmid}`, { jpeg, timestamp: now, node: resolvedNode })
    if (resolvedNode !== node) {
      screenshotCache.set(cacheKey, { jpeg, timestamp: now, node: resolvedNode })
    }

    return jpegResponse(jpeg, movedTo ? { "X-Screenshot-Moved-To": movedTo } : undefined)
  } catch (e: any) {
    console.error('[screenshot] failed:', e?.message ?? e)
    return NextResponse.json({ data: null, reason: 'error' })
  }
}
