import { okToStopPayload, type OkToStopPayload, type OkToStopResult } from "./okToStop"

/** What the cockpit routes tell the client when no verdict could be obtained. */
export const OK_TO_STOP_UNAVAILABLE = "Ceph could not be asked whether stopping is safe"

/**
 * okToStopPayload for a response to the browser: the raw error (PVE or SSH) names hosts
 * and addresses, so it goes to the log and the payload carries a fixed text.
 */
export function clientOkToStopPayload(check: OkToStopResult, osdIds: number[], label: string): OkToStopPayload {
  if (!check.verdict) console.error(`[${label}] ok-to-stop no verdict:`, String(check.error).replace(/[\r\n]/g, ""))
  const payload = okToStopPayload(check, osdIds)

  return check.verdict ? payload : { ...payload, message: OK_TO_STOP_UNAVAILABLE }
}
