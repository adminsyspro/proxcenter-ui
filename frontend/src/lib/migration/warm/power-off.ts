import type { WarmStatus } from "./types"
import { updateJob, appendLog, isCancelled, isForcePowerOffRequested } from "./job-control"

/** The three source-side power operations the confirmed power-off needs; one adapter per hypervisor. */
export interface PowerOffOps {
  requestShutdown(): Promise<void>
  waitPoweredOff(sliceMs: number): Promise<boolean>
  hardPowerOff(): Promise<void>
  /**
   * True when a refused shutdown request means the guest cannot be asked at all:
   * no guest tools (vSphere `ToolsUnavailableFault`, XAPI `VM_LACKS_FEATURE_SHUTDOWN`).
   * Such a guest will never honour a clean shutdown, so the pipeline powers it
   * off hard on its own instead of waiting for one. Any other refusal keeps the
   * operator wait. Omitted: every refusal is treated as the operator's call.
   */
  isGuestUnreachable?(error: unknown): boolean
}

/** vSphere refuses `ShutdownGuest` with this fault when Tools are not installed or not running. */
export function isVmwareToolsUnavailable(error: unknown): boolean {
  return /ToolsUnavailableFault|VMware Tools is not running/i.test(String((error as any)?.message || error))
}

/** XAPI refuses `VM.clean_shutdown` with this family of errors when the guest agent is absent. */
export function isXapiGuestAgentMissing(error: unknown): boolean {
  return /^VM_LACKS_FEATURE/.test(String((error as any)?.message || error))
}

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
/**
 * How long an automatic hard power off gets to show up as a powered-off state
 * before the wait is handed to the operator. `PowerOffVM_Task` returns once the
 * VM is off, so this is a sanity bound, not a budget the run is expected to use.
 */
export const HARD_POWER_OFF_CONFIRM_MS = 2 * 60 * 1000

/**
 * Clean guest shutdown then CONFIRM the source is powered off. Mandatory for a
 * valid final delta (section 9): a delta taken while the guest still writes is
 * invalid, so there is no proceed-anyway. Aborts if the source never stops.
 * `announce` is the log line for the shutdown request: the CBT path shuts down
 * at cutover (seconds of downtime left) while the checksum fallback shuts down
 * BEFORE the copy (VM off for the whole transfer) — one hardcoded "Cutover: …"
 * line misled operators on the fallback path (#587 field feedback).
 *
 * Two kinds of refusal, two behaviours:
 * - the guest has no tools at all (`ops.isGuestUnreachable`): it can never
 *   honour the request, so waiting for one, and asking the operator to click
 *   "Force power off" on every such VM of a bulk run, buys nothing. The source
 *   is powered off hard right away and the operator step is never shown. The
 *   final delta is crash-consistent, which is the best a guest without tools
 *   can offer, and what the operator would have clicked anyway;
 * - any other refusal (#614's "Undeclared fault" on a guest with running Tools):
 *   the hard power off stays the operator's decision, behind the
 *   `awaiting_power_off` step and its button, as before.
 */
export async function cleanShutdownAndConfirm(
  jobId: string,
  ops: PowerOffOps,
  announce: string,
  status: WarmStatus,
  opts: { waitMs?: number; sliceMs?: number; confirmMs?: number } = {},
): Promise<void> {
  await appendLog(jobId, announce)
  let refused = false
  let unreachable = false
  await ops.requestShutdown().catch(async (e: any) => {
    refused = true
    unreachable = ops.isGuestUnreachable?.(e) ?? false
    await appendLog(jobId, `Guest shutdown could not be initiated (${e?.message || e})`, "warn")
  })

  const sliceMs = opts.sliceMs ?? 10000
  if (unreachable && await autoHardPowerOff(jobId, ops, sliceMs, opts.confirmMs ?? HARD_POWER_OFF_CONFIRM_MS)) return

  const waitMs = opts.waitMs ?? POWER_OFF_WAIT_MS
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
      // A hard power off makes the final delta crash-consistent, which is why a
      // guest that could be asked is never stopped without the operator. If the
      // host refuses it too (an ESXi licence restriction does, as the cold path
      // already documents), keep waiting: the operator can still shut the guest
      // down from inside.
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

/**
 * The no-tools path: power the source off hard and confirm it. True when the
 * source is confirmed off. False hands the wait to the operator, either because
 * the host refused the hard power off (an ESXi licence restriction does) or
 * because the accepted power off never showed up as a powered-off state.
 */
async function autoHardPowerOff(jobId: string, ops: PowerOffOps, sliceMs: number, confirmMs: number): Promise<boolean> {
  await appendLog(jobId,
    "No guest tools are running on the source, so it can never honour a shutdown request: powering it off hard now. The final delta is crash-consistent, as after a power loss.",
    "warn")
  try {
    await ops.hardPowerOff()
  } catch (e: any) {
    await appendLog(jobId, `Hard power off was refused by the source host (${e?.message || e}); waiting for a powered-off state instead`, "error")
    return false
  }
  const confirmDeadline = Date.now() + confirmMs
  while (Date.now() < confirmDeadline) {
    if (isCancelled(jobId)) throw new Error("Migration cancelled")
    if (await ops.waitPoweredOff(Math.max(1, Math.min(sliceMs, confirmDeadline - Date.now())))) return true
  }
  await appendLog(jobId, "The hard power off was accepted but the source still reports a powered-on state; handing the wait over to the operator", "warn")
  return false
}
