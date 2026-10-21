import { executeSSH } from "@/lib/ssh/exec"
import { safeLog } from "@/lib/log/sanitize"
import { formatSshEndpoint, resolveNodeSshEndpoint } from "@/lib/ssh/node-endpoint"

import { okToStopCommand, parseOkToStop, type OkToStopVerdict } from "./nodeNoout"

/*
   `ceph osd ok-to-stop` over SSH (ui#1164), shared by the per-host noout
   route (every OSD of a node) and the service route (one OSD about to be
   stopped or restarted). The command is read-only, so it may run on a cluster
   outside the license; it exits 16 when stopping is unsafe but still prints
   its JSON, which is what is read. An SSH failure or an answer without JSON
   is "no verdict", never a safe one.
*/

export interface OkToStopResult {
  verdict: OkToStopVerdict | null
  error?: string
}

export interface OkToStopPayload extends OkToStopVerdict {
  /** Why no verdict could be obtained (SSH failure); null when it was. */
  message: string | null
}

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

/** The verdict as the API answers it: the OSDs asked about when none came back. */
export function okToStopPayload(result: OkToStopResult, osdIds: number[]): OkToStopPayload {
  if (result.verdict) return { ...result.verdict, message: null }
  return { ok: false, osds: osdIds, numOkPgs: 0, numNotOkPgs: 0, message: result.error || null }
}
