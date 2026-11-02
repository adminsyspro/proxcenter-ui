import { safeLog } from "@/lib/log/sanitize"
import { pveFetch } from "@/lib/proxmox/client"

import type { OkToStopResult } from "./okToStop"

/*
   Is stopping one OSD safe? PVE answers it itself, without SSH:
   `GET /nodes/{node}/ceph/cmd-safety?service=osd&id=<n>&action=stop` gives
   `{ safe: true }`, or `{ safe: false, status }` where `status` repeats the
   message of `ceph osd ok-to-stop` ("... (12 PGs are or would become
   offline)"). One read per call, nothing periodic.

   The status text names nothing the browser needs and may carry hosts or
   addresses, so only the number of PGs is read from it and the text is never
   returned. A PVE without the route (501, 404), an error, or an answer
   without a boolean `safe` is "no verdict", never a safe one. Never throws.
*/

const PG_COUNT = /(\d+)\s+PGs?\b/i

/**
 * Ask PVE, through `viaNode` (an online node of the cluster), whether stopping
 * `osd` is safe. `label` prefixes the log line with the calling route.
 */
export async function runOkToStopApi(conn: any, viaNode: string, osd: number, label = "ceph"): Promise<OkToStopResult> {
  try {
    const path = `/nodes/${encodeURIComponent(viaNode)}/ceph/cmd-safety?service=osd&id=${osd}&action=stop`
    console.log(`[${label}] ok-to-stop via PVE cmd-safety on ${safeLog(viaNode)}: osd.${osd}`)
    const answer = await pveFetch<any>(conn, path)
    const safe = answer?.safe

    if (typeof safe !== "boolean") {
      return { verdict: null, error: "ceph cmd-safety returned no verdict" }
    }
    if (safe) return { verdict: { ok: true, osds: [osd], numOkPgs: 0, numNotOkPgs: 0 } }

    const count = typeof answer.status === "string" ? PG_COUNT.exec(answer.status) : null

    return { verdict: { ok: false, osds: [osd], numOkPgs: 0, numNotOkPgs: count ? Number(count[1]) : 0 } }
  } catch (e: any) {
    return { verdict: null, error: e?.message || "ceph cmd-safety failed" }
  }
}
