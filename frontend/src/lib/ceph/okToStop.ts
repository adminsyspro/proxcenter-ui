import type { OkToStopVerdict } from "./nodeNoout"

/*
   Types shared by the two ways of asking Ceph whether stopping OSDs is safe:
   the PVE API (okToStopApi.ts, one OSD) and `ceph osd ok-to-stop` over SSH
   (okToStopSsh.ts, a whole host for the noout route). Nothing here talks to
   a node, so browser code may import it.
*/

export interface OkToStopResult {
  verdict: OkToStopVerdict | null
  error?: string
}

export interface OkToStopPayload extends OkToStopVerdict {
  /** Why no verdict could be obtained; null when it was. */
  message: string | null
}

/** The verdict as the API answers it: the OSDs asked about when none came back. */
export function okToStopPayload(result: OkToStopResult, osdIds: number[]): OkToStopPayload {
  if (result.verdict) return { ...result.verdict, message: null }
  return { ok: false, osds: osdIds, numOkPgs: 0, numNotOkPgs: 0, message: result.error || null }
}
