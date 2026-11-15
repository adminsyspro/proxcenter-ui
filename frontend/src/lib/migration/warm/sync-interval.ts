/**
 * Interval between two delta passes of a warm migration that waits for a
 * manual cutover.
 *
 * Each pass takes a snapshot of the source VM and consolidates it, so the
 * interval is what a waiting migration costs the source platform: one minute
 * keeps the copy and the downtime projection fresh, a longer one spares the
 * source when many VMs wait at once or the cutover is days away. The value is
 * set per source connection in Settings and can be overridden per migration.
 * It has no effect on an automatic cutover, whose passes follow one another
 * until the downtime budget is met.
 */
export const SYNC_INTERVAL_MIN_SEC = 60
export const SYNC_INTERVAL_MAX_SEC = 86400
export const SYNC_INTERVAL_DEFAULT_SEC = 60

/** Source connection types whose warm pipeline holds for a manual cutover. */
export const SYNC_INTERVAL_SOURCE_TYPES: readonly string[] = ["vmware", "xcpng"]

/**
 * Reads an interval sent by a client: `undefined` when nothing was sent,
 * `null` when the value is not a whole number of seconds inside the bounds.
 */
export function parseSyncInterval(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === "") return undefined
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isInteger(n) || n < SYNC_INTERVAL_MIN_SEC || n > SYNC_INTERVAL_MAX_SEC) return null
  return n
}

/** The intervals the sliders offer (Settings and the migration dialogs). */
export const SYNC_INTERVAL_STEPS_SEC: readonly number[] = [60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 43200, 86400]

/** Slider position of an interval: its step, the nearest one, or the default when nothing is set. */
export function syncIntervalStepIndex(seconds: number | null | undefined): number {
  const target = typeof seconds === "number" && Number.isFinite(seconds) ? seconds : SYNC_INTERVAL_DEFAULT_SEC
  let best = 0
  SYNC_INTERVAL_STEPS_SEC.forEach((step, i) => {
    if (Math.abs(step - target) < Math.abs(SYNC_INTERVAL_STEPS_SEC[best] - target)) best = i
  })
  return best
}

/** "15 min", "2 h": whole hours from one hour up, minutes otherwise. */
/**
 * A measured duration, to the second: "45 s", "1 min 1 s", "2 h 5 min". The
 * interval itself sits on a scale of whole minutes (formatSyncInterval); what
 * a sync actually took does not.
 */
export function formatSyncDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total} s`
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`
  return sec > 0 ? `${m} min ${sec} s` : `${m} min`
}

export function formatSyncInterval(seconds: number): string {
  return seconds >= 3600 && seconds % 3600 === 0 ? `${seconds / 3600} h` : `${Math.round(seconds / 60)} min`
}

/** A sync should leave the source at rest at least this many times its own length. */
export const SYNC_SUGGESTION_REST_RATIO = 4

/** A suggestion never extrapolates beyond this many times the period that was observed. */
export const SYNC_SUGGESTION_MAX_GROWTH = 4

/** Share of the downtime budget the last delta may use: the change rate of a VM varies through the day. */
export const SYNC_SUGGESTION_BUDGET_SHARE = 0.5

export interface SyncMeasure {
  /** How long a sync lasted, snapshot and consolidation included, in seconds. */
  passSec: number
  /** Bytes the VM changed per second over the observed period. */
  changeRateBytesPerSec: number
  /** Length of the period the change rate was measured over, in seconds. */
  observedWindowSec: number
  /** Copy rate of the full copy, the reference for what a sync copies per second. */
  throughputBytesPerSec: number
  /** Downtime budget of the migration, in seconds. */
  budgetSec: number
  /** Downtime every cutover costs whatever the delta: shutdown, boot, guest conversion. */
  fixedDowntimeSec: number
  /**
   * Downtime the migration aims at: the budget of an automatic cutover, a mere
   * target on a manual one, where it only sizes the suggestion and is shown
   * next to the estimate. Absent on a measure stored before it was recorded.
   */
  targetDowntimeSec?: number
}

/**
 * The longest interval, among the ones the sliders offer, that the syncs
 * measured so far support: the last delta must still be copied within half the
 * downtime budget, and the period is never stretched beyond four times what
 * was observed, so the suggestion grows step by step as the syncs confirm it.
 * A source that is slow to snapshot and merge comes first: it gets at least
 * four times the length of a sync to rest, even when that costs downtime.
 */
export function suggestSyncIntervalSec(m: SyncMeasure): number {
  const floor = SYNC_SUGGESTION_REST_RATIO * m.passSec
  const transferSec = (m.budgetSec - m.fixedDowntimeSec) * SYNC_SUGGESTION_BUDGET_SHARE
  let ceiling = Infinity
  if (m.changeRateBytesPerSec > 0 && m.throughputBytesPerSec > 0) {
    ceiling = transferSec > 0 ? (transferSec * m.throughputBytesPerSec) / m.changeRateBytesPerSec : SYNC_INTERVAL_MIN_SEC
  }
  const target = Math.min(ceiling, SYNC_SUGGESTION_MAX_GROWTH * m.observedWindowSec)
  const fitting = SYNC_INTERVAL_STEPS_SEC.filter(step => step <= target)
  const longest = fitting.length > 0 ? fitting[fitting.length - 1] : SYNC_INTERVAL_MIN_SEC
  if (longest >= floor) return longest
  return SYNC_INTERVAL_STEPS_SEC.find(step => step >= floor) ?? SYNC_INTERVAL_MAX_SEC
}

/** What the syncs of a wait measured, kept on the job so the cutover can be estimated for any interval. */
export interface CutoverMeasure {
  /** Bytes the VM changed per second over the busiest of the last syncs. */
  changeRateBytesPerSec: number
  /** Copy rate of the full copy, the reference for what a sync copies per second. */
  throughputBytesPerSec: number
  /** Part of a sync that is not copy: snapshot, changed-block query, consolidation. */
  passOverheadSec: number
  /** Downtime every cutover costs whatever the delta: shutdown, boot, guest conversion. */
  fixedDowntimeSec: number
  /**
   * Downtime the migration aims at: the budget of an automatic cutover, a mere
   * target on a manual one, where it only sizes the suggestion and is shown
   * next to the estimate. Absent on a measure stored before it was recorded.
   */
  targetDowntimeSec?: number
}

const MEASURE_KEYS = ["changeRateBytesPerSec", "throughputBytesPerSec", "passOverheadSec", "fixedDowntimeSec"] as const

/** A measure read back from the job row, or null when it is not one. */
export function parseCutoverMeasure(value: unknown): CutoverMeasure | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  if (MEASURE_KEYS.some(key => typeof v[key] !== "number" || !Number.isFinite(v[key] as number) || (v[key] as number) < 0)) return null
  const measure = Object.fromEntries(MEASURE_KEYS.map(key => [key, v[key]])) as unknown as CutoverMeasure
  const target = v.targetDowntimeSec
  return typeof target === "number" && Number.isFinite(target) && target > 0 ? { ...measure, targetDowntimeSec: target } : measure
}

/** A VM that writes as fast as the copy goes never catches up: the estimate stops at this share. */
const MAX_CHANGE_SHARE = 0.95

/**
 * What a cutover asked a whole interval after the last sync costs. The copy is
 * first brought up to date while the source still runs (catch-up, see
 * catch-up.ts): that sync copies an interval of changes, so its length grows
 * with the interval. The source then stops and only what changed during the
 * catch-up is left to copy, on top of the fixed cost of every cutover.
 */
export function estimateCutover(m: CutoverMeasure, intervalSec: number): { catchUpSec: number; downtimeSec: number } {
  const share = m.throughputBytesPerSec > 0 ? Math.min(m.changeRateBytesPerSec / m.throughputBytesPerSec, MAX_CHANGE_SHARE) : 0
  const catchUpSec = m.passOverheadSec + share * intervalSec
  return { catchUpSec: Math.round(catchUpSec), downtimeSec: Math.round(m.fixedDowntimeSec + share * catchUpSec) }
}
