// The log of a migration job only grows: every pipeline appends to it. A poll
// that already holds the first n lines asks for the rest (`after=n`) instead
// of the whole log again. Free of server imports, the browser merges with it.

export interface JobLogSlice<L = unknown> {
  /** The lines from `logOffset` on. */
  logs: L[]
  /** Index of the first line sent; 0 means the whole log. */
  logOffset: number
  /** Lines in the whole log. */
  logCount: number
}

function toOffset(raw: string): number | undefined {
  if (!/^\d{1,9}$/.test(raw)) return undefined
  return Number(raw)
}

/** `?after=<n>` of a job read, undefined when absent or not a count. */
export function parseLogOffset(raw: string | null): number | undefined {
  return raw == null ? undefined : toOffset(raw)
}

/** `?logsAfter=<n>,<n>,...` of a batch read, one count per job in batch order. */
export function parseLogOffsets(raw: string | null): number[] | undefined {
  if (!raw) return undefined
  const offsets = raw.split(',').map(toOffset)
  return offsets.every(o => o !== undefined) ? (offsets as number[]) : undefined
}

/** The lines past `after`; the whole log when `after` is missing or beyond it. */
export function sliceJobLogs<L = unknown>(logs: unknown, after?: number): JobLogSlice<L> {
  const all = (Array.isArray(logs) ? logs : []) as L[]
  const logOffset = after !== undefined && after <= all.length ? after : 0

  return { logs: logOffset ? all.slice(logOffset) : all, logOffset, logCount: all.length }
}

/**
 * The log the browser keeps for a job after a read: the read replaces it when
 * it sent the whole log (or another job), extends it when it starts where the
 * kept one ends. A slice that does not fit (two reads crossed) keeps what was
 * there; the next read asks again from its end.
 */
export function mergeJobLogs<L>(
  previous: { id?: string; logs?: L[] | null } | null | undefined,
  next: { id?: string; logs?: L[] | null; logOffset?: number },
): L[] {
  const incoming = next.logs ?? []
  if (!next.logOffset || !previous || previous.id !== next.id) return incoming
  const kept = previous.logs ?? []

  return kept.length === next.logOffset ? kept.concat(incoming) : kept
}
