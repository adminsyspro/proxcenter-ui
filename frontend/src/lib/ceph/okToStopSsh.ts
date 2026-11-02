import { executeSSH } from "@/lib/ssh/exec"
import { safeLog } from "@/lib/log/sanitize"
import { formatSshEndpoint, resolveNodeSshEndpoint } from "@/lib/ssh/node-endpoint"

import { okToStopCommand, parseOkToStop } from "./nodeNoout"
import type { OkToStopResult } from "./okToStop"

export { okToStopPayload, type OkToStopPayload, type OkToStopResult } from "./okToStop"

/*
   `ceph osd ok-to-stop` over SSH (ui#1164), now only for the per-host noout
   route (every OSD of a host at once, next to `ceph osd set-group`, which
   needs SSH anyway). One OSD (cockpit precheck, out guard, service guard) is
   asked through the PVE API instead, see okToStopApi.ts. The command is
   read-only, so it may run on a cluster outside the license; it exits 16
   when stopping is unsafe but still prints its JSON, which is what is read.
   An SSH failure or an answer without JSON is "no verdict", never a safe one.
*/

/**
 * Run the precheck for a set of OSDs on `viaNode` (an online node of the
 * cluster). `label` prefixes the log line with the calling route.
 */
export async function runOkToStop(
  connId: string,
  conn: any,
  viaNode: string,
  osdIds: number[],
  label = "ceph",
): Promise<OkToStopResult> {
  const command = okToStopCommand(osdIds)
  try {
    const endpoint = await resolveNodeSshEndpoint(conn, viaNode)
    console.log(`[${label}] ok-to-stop via SSH on ${safeLog(formatSshEndpoint(endpoint))}: ${safeLog(command)}`)
    const result = await executeSSH(connId, endpoint, command, 30_000, { readOnly: true })
    if (!result.success) return { verdict: null, error: result.error || "ceph osd ok-to-stop failed" }
    const verdict = parseOkToStop(result.output)
    if (!verdict) return { verdict: null, error: "ceph osd ok-to-stop returned no verdict" }
    return { verdict }
  } catch (e: any) {
    return { verdict: null, error: e?.message || "ceph osd ok-to-stop failed" }
  }
}
