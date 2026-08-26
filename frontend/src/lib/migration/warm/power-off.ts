import type { WarmStatus } from "./types"
import { updateJob, appendLog, isCancelled, isForcePowerOffRequested } from "./job-control"

/** The three source-side power operations the confirmed power-off needs; one adapter per hypervisor. */
export interface PowerOffOps {
  requestShutdown(): Promise<void>
  waitPoweredOff(sliceMs: number): Promise<boolean>
  hardPowerOff(): Promise<void>
}

/**
 * Clean guest shutdown then CONFIRM the source is powered off. Mandatory for a
 * valid final delta (section 9): a delta taken while the guest still writes is
 * invalid, so there is no proceed-anyway. Aborts if the source never stops.
 * `announce` is the log line for the shutdown request: the CBT path shuts down
 * at cutover (seconds of downtime left) while the checksum fallback shuts down
 * BEFORE the copy (VM off for the whole transfer) — one hardcoded "Cutover: …"
 * line misled operators on the fallback path (#587 field feedback).
 */
/**
 * How long the pipeline waits for a confirmed powered-off source before giving up.
 *
 * This wait used to be five minutes and completely silent: no status change, no
 * notification, no action. A guest that refused the shutdown therefore burnt the
 * whole run, and on a job that had been copying for hours nobody was watching the
 * log pane (#587, #614). Now that the wait announces itself and offers a hard
 * power off, it is long enough for a human to notice and decide, and still
 * bounded so an unattended job fails cleanly instead of pinning a VDDK session
 * and a snapshot for ever.
 */
export const POWER_OFF_WAIT_MS = 30 * 60 * 1000
/** How often the wait restates itself, with the time left, in the job log. */
export const POWER_OFF_HEARTBEAT_MS = 60 * 1000

export async function cleanShutdownAndConfirm(
  jobId: string,
  ops: PowerOffOps,
  announce: string,
  status: WarmStatus,
  opts: { waitMs?: number; sliceMs?: number } = {},
): Promise<void> {
  await appendLog(jobId, announce)
  let refused = false
  await ops.requestShutdown().catch(async (e: any) => {
    refused = true
    await appendLog(jobId, `Guest shutdown could not be initiated (${e?.message || e})`, "warn")
  })

  const waitMs = opts.waitMs ?? POWER_OFF_WAIT_MS
  const sliceMs = opts.sliceMs ?? 10000
  const deadline = Date.now() + waitMs
  // A step of its own, so the UI can say what is happening and offer the way out
  // instead of showing a migration that looks stuck mid-cutover.
  await updateJob(jobId, status, { currentStep: "awaiting_power_off" })
  await appendLog(jobId,
    `${refused ? "The guest refused the shutdown request. " : ""}Waiting up to ${Math.round(waitMs / 60000)} min for the source to reach a confirmed powered-off state. Shut it down from the guest, or use "Force power off" to stop it now.`,
    refused ? "warn" : "info")

  let forced = false
  let nextHeartbeat = Date.now() + POWER_OFF_HEARTBEAT_MS
  let off = false
  while (Date.now() < deadline) {
    if (isCancelled(jobId)) throw new Error("Migration cancelled")
    if (!forced && isForcePowerOffRequested(jobId)) {
      forced = true
      await appendLog(jobId, "Operator requested a hard power off of the source", "warn")
      // A hard power off makes the final delta crash-consistent, which is why it
      // is never automatic. If the host refuses it too (an ESXi licence
      // restriction does, as the cold path already documents), keep waiting: the
      // operator can still shut the guest down from inside.
      await ops.hardPowerOff().catch(async (e: any) => {
        await appendLog(jobId, `Hard power off was refused by the source host (${e?.message || e}); still waiting for a powered-off state`, "error")
      })
    }
    if (await ops.waitPoweredOff(Math.max(1, Math.min(sliceMs, deadline - Date.now())))) {
      off = true
      break
    }
    if (Date.now() >= nextHeartbeat && Date.now() < deadline) {
      const leftMin = Math.max(1, Math.round((deadline - Date.now()) / 60000))
      await appendLog(jobId, `Still waiting for the source to power off; ${leftMin} min left before the migration gives up`)
      nextHeartbeat = Date.now() + POWER_OFF_HEARTBEAT_MS
    }
  }
  // Careful with the wording: the CBT path reaches this AFTER the full copy, so a
  // completed copy is kept, but the checksum fallback shuts the source down BEFORE
  // copying anything, and those unmarked volumes are still freed. State the rule,
  // never promise a copy that may not exist (#612).
  if (!off) throw new Error("Cutover aborted: source VM did not reach a confirmed powered-off state (no final delta taken; any target volume holding a completed copy is kept, not deleted)")
}
