import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { parseHwmon } from "@/lib/sensors/hwmon"
import { executeSSH } from "@/lib/ssh/exec"
import { getNodeIp } from "@/lib/ssh/node-ip"

export const runtime = "nodejs"

/**
 * GET /api/v1/connections/[id]/nodes/[node]/sensors
 *
 * Node temperatures, read from the kernel hwmon tree over SSH.
 *
 * There is no Proxmox endpoint for this: the node API exposes no `sensors`
 * sub-path, and neither lm-sensors nor ipmitool is installed on a stock PVE
 * node, so sysfs over SSH is the only source that needs nothing installed on
 * the host. See lib/sensors/hwmon.ts for the output shape.
 *
 * Never an error response for a node that simply has no sensors to report: a
 * virtualized node, a connection without SSH, or a host whose chips expose no
 * temperature all answer 200 with `available: false` so the caller renders
 * nothing instead of an error nobody can act on.
 */

/** Single command, no interpolation: nothing user-supplied reaches the shell.
 *  `|| true` because grep exits 1 when no file matches, which is the normal
 *  answer on a node with no hwmon temperature at all. */
const HWMON_COMMAND =
  "grep -H . /sys/class/hwmon/hwmon*/name /sys/class/hwmon/hwmon*/temp*_label /sys/class/hwmon/hwmon*/temp*_input 2>/dev/null || true"

/** smartctl aside, this is a sysfs read: fast on a healthy host, and not worth
 *  waiting on when the SSH path itself is degraded. */
const SSH_TIMEOUT_MS = 8_000

/** Temperatures move slowly and every read costs an SSH round trip, so a short
 *  memo keeps clicking through an inventory tree from opening a session per
 *  node. Keyed by connection and node; the RBAC check above runs before any
 *  cache read, so a cached entry is never served to a caller who could not
 *  have fetched it. */
const CACHE_TTL_MS = 60_000

type CacheEntry = { at: number; body: SensorsBody }

const cache = new Map<string, CacheEntry>()

type SensorsBody =
  | { available: false; reason: "ssh-unavailable" | "no-sensors" }
  | { available: true; readings: ReturnType<typeof parseHwmon>["readings"]; byRole: ReturnType<typeof parseHwmon>["byRole"]; hottest: ReturnType<typeof parseHwmon>["hottest"] }

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> | { id: string; node: string } }
) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    const node = (params as any)?.node

    if (!id || !node) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 })
    }

    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "connection", id)

    if (denied) return denied

    const cacheKey = `${id}:${node}`
    const cached = cache.get(cacheKey)

    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json({ data: cached.body })
    }

    const conn = await getConnectionById(id)

    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const nodeIp = await getNodeIp(conn, node)
    const result = await executeSSH(id, nodeIp, HWMON_COMMAND, SSH_TIMEOUT_MS)

    // SSH disabled on the connection, host unreachable, credentials rejected:
    // all indistinguishable to the caller and all mean the same thing on
    // screen, so they collapse into one reason rather than leaking detail.
    const body: SensorsBody = result.success
      ? toBody(parseHwmon(result.output ?? ""))
      : { available: false, reason: "ssh-unavailable" }

    cache.set(cacheKey, { at: Date.now(), body })

    return NextResponse.json({ data: body })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to read sensors" }, { status: 500 })
  }
}

function toBody(sensors: ReturnType<typeof parseHwmon>): SensorsBody {
  if (sensors.readings.length === 0) return { available: false, reason: "no-sensors" }

  return { available: true, ...sensors }
}
