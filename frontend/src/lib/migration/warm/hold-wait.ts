/**
 * The wait between two delta passes of a manual hold, as the warm pipelines
 * (VMware and XCP-ng) call it: how long, from the job's own setting or its
 * source connection's, what the job log says meanwhile, and which interval the
 * syncs measured so far suggest.
 */
import { appendLog, clearWarmTest, readJobConfig, updateJobFields } from "./job-control"
import { holdBetweenPasses } from "./hold-slot"
import { estimateCutover, formatSyncDuration, formatSyncInterval, suggestSyncIntervalSec, type CutoverMeasure } from "./sync-interval"
import { resolveSyncIntervalSec } from "./sync-interval-source"

interface HoldConfig {
  syncIntervalSec?: number
  sourceConnectionId: string
}

/** What the pipeline measured on the delta pass that just ended. */
export interface HoldPassStats {
  /** How long the pass lasted, snapshot and consolidation included, in seconds. */
  durationSec: number
  /** Bytes the pass copied. */
  deltaBytes: number
  /** Copy rate of the full copy: what a sync can copy per second once its snapshot is taken. */
  throughputBytesPerSec: number
  /** Downtime budget of the migration, in seconds. */
  budgetSec: number
  /** Downtime every cutover costs whatever the delta: shutdown, boot, guest conversion. */
  fixedDowntimeSec: number
}

/** Syncs a suggestion looks back on: the slowest one and the busiest period among them count. */
const SUGGESTION_HISTORY = 3

interface HoldState {
  /** The job was already told, in this run, that its syncs outlast their interval. */
  slowSyncWarned: boolean
  /** When the previous pass of the hold took its snapshot. */
  lastPassStartMs?: number
  /** Length, non-copy part and change rate of the last syncs, newest last. */
  measures: Array<{ passSec: number; overheadSec: number; changeRateBytesPerSec: number }>
}

/** What this instance remembers of the jobs it holds, dropped when the hold ends. */
const holds = new Map<string, HoldState>()

function stateOf(jobId: string): HoldState {
  let state = holds.get(jobId)
  if (!state) { state = { slowSyncWarned: false, measures: [] }; holds.set(jobId, state) }
  return state
}

/**
 * Say once per run that a sync lasted longer than the pause that follows it:
 * the source then snapshots and merges almost back to back, which the interval
 * was meant to spare it. A log that cannot be written never fails the wait.
 */
async function warnSlowSync(jobId: string, state: HoldState, lastPassSec: number, intervalSec: number): Promise<void> {
  if (lastPassSec <= intervalSec || state.slowSyncWarned) return
  state.slowSyncWarned = true
  await appendLog(jobId, `The last sync took ${formatSyncDuration(lastPassSec)}, longer than the ${formatSyncInterval(intervalSec)} interval between two syncs: the source spends more time taking and merging snapshots than resting. A longer interval would relieve it.`, "warn").catch(() => {})
}

/**
 * Record the pass that just ended and store what the last syncs say: the
 * interval they suggest, the measure the cutover is estimated from, and the
 * downtime a cutover would cost at the interval in force. The change rate of a
 * pass is what it copied over the time since the previous snapshot, so the
 * first pass of a hold only sets the clock. The write is best effort and never
 * touches a job that has ended.
 */
async function recordPass(jobId: string, state: HoldState, pass: HoldPassStats, intervalSec: number): Promise<void> {
  const startMs = Date.now() - pass.durationSec * 1000
  const previousStartMs = state.lastPassStartMs
  state.lastPassStartMs = startMs
  if (previousStartMs === undefined) return
  const observedWindowSec = Math.max(1, (startMs - previousStartMs) / 1000)
  const copySec = pass.throughputBytesPerSec > 0 ? Math.max(0, pass.deltaBytes) / pass.throughputBytesPerSec : 0
  state.measures.push({
    passSec: pass.durationSec,
    overheadSec: Math.max(0, pass.durationSec - copySec),
    changeRateBytesPerSec: Math.max(0, pass.deltaBytes) / observedWindowSec,
  })
  if (state.measures.length > SUGGESTION_HISTORY) state.measures.shift()
  const changeRateBytesPerSec = Math.max(...state.measures.map(m => m.changeRateBytesPerSec))
  const suggestedSyncIntervalSec = suggestSyncIntervalSec({
    passSec: Math.max(...state.measures.map(m => m.passSec)),
    changeRateBytesPerSec,
    observedWindowSec,
    throughputBytesPerSec: pass.throughputBytesPerSec,
    budgetSec: pass.budgetSec,
    fixedDowntimeSec: pass.fixedDowntimeSec,
  })
  const syncMeasure: CutoverMeasure = {
    changeRateBytesPerSec,
    throughputBytesPerSec: pass.throughputBytesPerSec,
    passOverheadSec: Math.max(...state.measures.map(m => m.overheadSec)),
    fixedDowntimeSec: pass.fixedDowntimeSec,
    targetDowntimeSec: pass.budgetSec,
  }
  // The projection the pipeline wrote counts a whole interval of changes as
  // downtime; with the catch-up sync only what changes during it is.
  const projectedDowntimeSec = estimateCutover(syncMeasure, intervalSec).downtimeSec
  await updateJobFields(jobId, { suggestedSyncIntervalSec, syncMeasure, projectedDowntimeSec }).catch(() => {})
}

/** The test of the waiting copy, run by the pipeline that owns the copy (migration-test.ts). */
export interface HoldTest {
  /** Boots the test VM, waits for its end and removes it; throws only "Migration cancelled". */
  run: () => Promise<void>
}

/**
 * Sleep until the next delta pass of a manual hold. The interval is read again
 * from the job's row and its source connection during the sleep, so a change
 * made in Settings or on the waiting migration itself takes effect without
 * waiting for the sleep to end. `pass` is what the pass that just ended
 * measured. A test the operator asks for meanwhile runs through `test`, and a
 * pass follows it at once, to catch up on what changed while the syncs were
 * paused. True when the next pass may run, false when the operator asked for
 * the cutover; throws on cancellation.
 */
export async function awaitNextHoldPass(jobId: string, config: HoldConfig, pass?: HoldPassStats, test?: HoldTest): Promise<boolean> {
  const state = stateOf(jobId)
  let known: number | undefined
  // The row is read rather than the config the pipeline started with: the
  // operator may have changed the interval since. A read that fails keeps the
  // value the job started with.
  const readInterval = async () => {
    const own = await readJobConfig(jobId).then(c => c.syncIntervalSec, () => config.syncIntervalSec)
    const sec = await resolveSyncIntervalSec(own, config.sourceConnectionId)
    if (known !== undefined && sec !== known) {
      await appendLog(jobId, `Interval between two syncs changed from ${formatSyncInterval(known)} to ${formatSyncInterval(sec)}.`, "info").catch(() => {})
    }
    known = sec
    return sec
  }
  let next: "pass" | "cutover"
  try {
    if (pass) {
      const intervalSec = await readInterval()
      await warnSlowSync(jobId, state, pass.durationSec, intervalSec)
      await recordPass(jobId, state, pass, intervalSec)
    }
    const opts = {
      onWaitForSlot: () => appendLog(jobId, "Next sync is waiting for a free migration slot: the limits of the target cluster, of its node or of the source host are reached, or VMs of a bulk migration are still queued.", "info"),
      onWaitForCutoverSlot: () => appendLog(jobId, "Cutover requested: waiting for its turn, as many cutovers as the node or the source host allows are already running. The source VM stays up meanwhile.", "info"),
    }
    let held = await holdBetweenPasses(jobId, readInterval, opts)
    while (held === "test") {
      if (test) await test.run()
      else await declineTest(jobId)
      held = await holdBetweenPasses(jobId, 0, { ...opts, afterIdle: true })
    }
    next = held
  } catch (err) {
    holds.delete(jobId)
    throw err
  }
  if (next !== "pass") holds.delete(jobId)
  return next === "pass"
}

/** A test asked of a pipeline that cannot run one: said in the log and dropped, so the hold goes on. */
async function declineTest(jobId: string): Promise<void> {
  await appendLog(jobId, "A test was requested, but this migration cannot run one", "warn").catch(() => {})
  await updateJobFields(jobId, { testRequest: null, testStopRequestedAt: null, testState: { phase: "failed", reason: "not supported by this migration" } }).catch(() => {})
  clearWarmTest(jobId)
}

/** The interval a hold starts with, for the job log ("15 min", "2 h"). */
export async function describeHoldInterval(config: HoldConfig): Promise<string> {
  return formatSyncInterval(await resolveSyncIntervalSec(config.syncIntervalSec, config.sourceConnectionId))
}
