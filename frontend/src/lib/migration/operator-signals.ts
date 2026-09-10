/**
 * Operator decisions that have to reach a pipeline which is already running:
 * "cut over now", "power the source off hard", "convert this root".
 *
 * Every migration pipeline used to keep these in a module-level Set, on the
 * assumption that the POST handler and the `after()` continuation running the
 * pipeline share one module instance. They do not, and when they do not the
 * click is lost in silence:
 *
 *  - in dev, a route compiled after the pipeline started gets its own instance
 *    of the shared module, so the route fills one Set while the pipeline polls
 *    another (measured on a warm run: the cutover route was compiled on the
 *    first click, twelve minutes after the pipeline began);
 *  - in production, a second frontend replica has its own process entirely,
 *    and only one of them owns the job (see `ownerInstanceId`).
 *
 * So the decision is written on the job row, which every replica and every
 * module instance can see, and each pipeline mirrors the row back into its own
 * registry for as long as the job runs. The in-memory Set stays as the fast
 * path, which keeps every existing synchronous `isCancelled()` style check
 * working unchanged.
 *
 * Cancellation needs no column: the cancel route already writes
 * `status = "cancelled"` on the row, so the status is its durable signal.
 */

/**
 * Mirror cadence. A cutover request costs at most this much extra latency,
 * which is nothing next to the shutdown plus boot it is about to trigger, and
 * it is one narrow indexed read per running job.
 */
export const OPERATOR_SIGNAL_POLL_MS = 2000

export type OperatorSignalSnapshot = {
  /** The row says the job was cancelled, whoever wrote it. */
  cancelled: boolean
  /** An operator asked for the cutover to run now. */
  cutover: boolean
  /** An operator asked to stop waiting for a clean guest shutdown. */
  forcePowerOff: boolean
  /** Root filesystem an operator picked for a parked v2v conversion. */
  rootChoice: string | null
}

const SIGNAL_SELECT = {
  status: true,
  cutoverRequestedAt: true,
  forcePowerOffRequestedAt: true,
  rootChoice: true,
} as const

/** Read the decisions currently recorded for a job, or null when it is gone. */
export async function readOperatorSignals(prisma: any, jobId: string): Promise<OperatorSignalSnapshot | null> {
  const row = await prisma.migrationJob.findUnique({ where: { id: jobId }, select: SIGNAL_SELECT })
  if (!row) return null

  return {
    cancelled: row.status === "cancelled",
    cutover: row.cutoverRequestedAt != null,
    forcePowerOff: row.forcePowerOffRequestedAt != null,
    rootChoice: typeof row.rootChoice === "string" && row.rootChoice ? row.rootChoice : null,
  }
}

/**
 * Drop anything recorded before this run started. No route writes these
 * columns outside a live run today, and a retry creates a new row rather than
 * reusing this one, so this is a guard rather than a fix: a run must never
 * inherit a decision it did not see taken, least of all a "cutover now" it
 * would honour on its first delta pass. updateMany so a job whose row
 * disappeared under us does not throw.
 */
export async function clearOperatorSignals(prisma: any, jobId: string): Promise<void> {
  await prisma.migrationJob.updateMany({
    where: { id: jobId },
    data: { cutoverRequestedAt: null, forcePowerOffRequestedAt: null, rootChoice: null },
  })
}

/** Stop functions of the running mirrors, keyed by job id. */
const watchers = new Map<string, () => void>()

/**
 * Mirror a job's recorded decisions into the caller's own registries until the
 * run ends. `apply` is called with every snapshot, including the ones that
 * carry nothing new: callers add to a Set, which is idempotent.
 *
 * Runs in whichever module instance the pipeline itself runs in, since the
 * pipeline is what calls this, so the Sets it fills are always the ones the
 * pipeline polls. That is the whole point of the indirection.
 */
export async function startOperatorSignalWatch(
  prisma: any,
  jobId: string,
  apply: (signals: OperatorSignalSnapshot) => void,
  pollMs: number = OPERATOR_SIGNAL_POLL_MS,
): Promise<void> {
  stopOperatorSignalWatch(jobId)
  // Clear before the first read, or the mirror could hand this run a decision
  // that predates it. A failure here is not worth aborting on: the very next
  // status write would fail too, and the run dies on that instead.
  await clearOperatorSignals(prisma, jobId).catch(() => {})

  let stopped = false
  let inFlight = false
  const tick = async () => {
    if (stopped || inFlight) return
    inFlight = true
    try {
      const signals = await readOperatorSignals(prisma, jobId)
      if (signals && !stopped) apply(signals)
    } catch {
      // A failed poll is retried on the next tick. Nothing is lost: the row
      // keeps the decision until the pipeline picks it up.
    } finally {
      inFlight = false
    }
  }

  const timer = setInterval(tick, pollMs)
  // The mirror must never be the reason the process stays alive.
  timer.unref?.()
  watchers.set(jobId, () => {
    stopped = true
    clearInterval(timer)
  })
  // One read before returning, so the caller can rely on the mirror being live
  // by the time its run starts rather than one interval later.
  await tick()
}

/** Stop mirroring a job. Safe to call for a job that was never watched. */
export function stopOperatorSignalWatch(jobId: string): void {
  const stop = watchers.get(jobId)
  if (stop) {
    stop()
    watchers.delete(jobId)
  }
}

/** @internal test hook */
export function __watchedJobsForTest(): string[] {
  return [...watchers.keys()]
}
