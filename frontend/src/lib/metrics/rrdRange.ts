/**
 * Custom time window support for the RRD (performance) charts.
 *
 * Proxmox only answers `rrddata?timeframe=hour|day|week|month|year`: there is
 * no way to ask it for an arbitrary [from, to]. What it stores underneath is a
 * handful of round-robin archives, each a fixed step over a fixed depth, and
 * every timeframe is just a window on one of them ending at *now*.
 *
 * Measured on PVE 9.2 (`pve-node-9.0` format, lab nodes pve1 and the DR node):
 *
 *   timeframe | points | step    | depth
 *   hour      |     60 |    60 s | 1 h
 *   day       |   1440 |    60 s | 24 h
 *   week      |    336 |  1800 s | 7 d
 *   month     |   1440 |  1800 s | 30 d
 *   year      |   1440 | 21600 s | 360 d
 *
 * So a custom window is served by fetching the finest archive that still
 * reaches back to `from`, then clipping. That gives a genuinely arbitrary
 * window, at the resolution Proxmox happens to keep for that depth: 60 s
 * within the last 24 h, 30 min within 30 days, 6 h within a year. Nothing
 * finer than 60 s and nothing older than ~360 days will ever exist.
 *
 * The step figures are a fallback only: `rrdRangeMeta` re-derives the real
 * step from the timestamps the node actually returned, so a PVE 8 node (whose
 * archives are 70 points each, a completely different layout) reports its own
 * resolution instead of this table's.
 */

export type RrdTimeframe = 'hour' | 'day' | 'week' | 'month' | 'year'

export const RRD_TIMEFRAMES: readonly RrdTimeframe[] = ['hour', 'day', 'week', 'month', 'year'] as const

export function isRrdTimeframe(value: unknown): value is RrdTimeframe {
  return typeof value === 'string' && (RRD_TIMEFRAMES as readonly string[]).includes(value)
}

/** Ordered from the finest/shallowest to the coarsest/deepest archive. */
export const RRD_ARCHIVES: readonly { timeframe: RrdTimeframe; depthSeconds: number; stepSeconds: number }[] = [
  { timeframe: 'hour', depthSeconds: 3_600, stepSeconds: 60 },
  { timeframe: 'day', depthSeconds: 86_400, stepSeconds: 60 },
  { timeframe: 'week', depthSeconds: 604_800, stepSeconds: 1_800 },
  { timeframe: 'month', depthSeconds: 2_592_000, stepSeconds: 1_800 },
  { timeframe: 'year', depthSeconds: 31_104_000, stepSeconds: 21_600 },
] as const

/** Finest step Proxmox records. A shorter window cannot gain any detail. */
export const RRD_MIN_STEP_SECONDS = 60

/** Deepest archive. Anything older than this is simply not kept. */
export const RRD_MAX_LOOKBACK_SECONDS = 31_104_000

export type RrdWindow = { from: number; to: number }

export type RrdRangeMeta = {
  /** Archive actually fetched from Proxmox. */
  timeframe: RrdTimeframe
  /** Resolution of the returned points, in seconds. */
  stepSeconds: number
  /** Window actually served, after clamping. */
  from: number
  to: number
  /** Number of points left after clipping. */
  points: number
  /** The requested start was older than what Proxmox keeps, and was clamped. */
  truncated: boolean
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

/**
 * Parses a [from, to] window (epoch seconds) coming from a query string or a
 * request body. Returns null when the pair is absent or unusable, so the
 * caller falls back to a plain preset timeframe.
 */
export function parseRrdWindow(from: unknown, to: unknown): RrdWindow | null {
  const f = Math.floor(Number(from))
  const t = Math.floor(Number(to))

  if (!Number.isFinite(f) || !Number.isFinite(t)) return null
  if (f <= 0 || t <= 0) return null
  if (t <= f) return null

  return { from: f, to: t }
}

/**
 * Clamps a window to what Proxmox can answer: never in the future, never
 * older than the deepest archive.
 */
export function clampRrdWindow(window: RrdWindow, now = nowSeconds()): { window: RrdWindow; truncated: boolean } {
  const oldest = now - RRD_MAX_LOOKBACK_SECONDS
  const truncated = window.from < oldest
  const from = truncated ? oldest : window.from
  const to = Math.min(window.to, now)

  return { window: { from, to: Math.max(to, from + 1) }, truncated }
}

/**
 * Picks the archive to fetch for a window: the finest one that still reaches
 * back to `from`. Every Proxmox archive ends at *now*, so the depth needed is
 * measured from now, not from the window length.
 *
 * The depth is discounted by one step because an archive's oldest point sits
 * one step inside its nominal depth (`hour` answers 60 points covering 59
 * minutes, not 60). Without that margin a window starting exactly one hour ago
 * would be served by the hour archive and lose its first point.
 */
export function timeframeForWindow(window: RrdWindow, now = nowSeconds()): RrdTimeframe {
  const lookback = Math.max(0, now - window.from)
  const archive = RRD_ARCHIVES.find(a => a.depthSeconds - a.stepSeconds >= lookback)

  return archive ? archive.timeframe : 'year'
}

/** Nominal step of an archive, used before any data has come back. */
export function stepSecondsForTimeframe(timeframe: RrdTimeframe): number {
  return RRD_ARCHIVES.find(a => a.timeframe === timeframe)?.stepSeconds ?? RRD_MIN_STEP_SECONDS
}

function rowTime(row: any): number | null {
  const t = Number(row?.time)

  return Number.isFinite(t) && t > 0 ? t : null
}

/** Keeps the points inside the window. Rows without a usable `time` are dropped. */
export function clipRrdRows<T>(rows: T[], window: RrdWindow): T[] {
  if (!Array.isArray(rows)) return []

  return rows.filter(row => {
    const t = rowTime(row)

    return t != null && t >= window.from && t <= window.to
  })
}

/**
 * Real step of a series, read from its own timestamps rather than assumed, so
 * a node whose archives differ from the PVE 9 table above still reports the
 * truth. Falls back to the nominal step when there is nothing to measure.
 */
export function stepSecondsFromRows(rows: any[], timeframe: RrdTimeframe): number {
  const times = (Array.isArray(rows) ? rows : [])
    .map(rowTime)
    .filter((t): t is number => t != null)

  if (times.length < 2) return stepSecondsForTimeframe(timeframe)

  const deltas: number[] = []

  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1]

    if (d > 0) deltas.push(d)
  }

  if (deltas.length === 0) return stepSecondsForTimeframe(timeframe)
  deltas.sort((a, b) => a - b)

  return deltas[Math.floor(deltas.length / 2)]
}

/**
 * Serves a custom window from a full archive: fetch `timeframe`, clip here.
 * `rows` is what Proxmox returned for that timeframe.
 */
export function applyRrdWindow<T>(
  rows: T[],
  window: RrdWindow,
  timeframe: RrdTimeframe,
  truncated: boolean,
): { rows: T[]; meta: RrdRangeMeta } {
  const clipped = clipRrdRows(rows, window)

  return {
    rows: clipped,
    meta: {
      timeframe,
      stepSeconds: stepSecondsFromRows(clipped.length >= 2 ? clipped : (rows as any[]), timeframe),
      from: window.from,
      to: window.to,
      points: clipped.length,
      truncated,
    },
  }
}

/** Meta for a plain preset request, so both paths answer the same shape. */
export function presetRangeMeta(rows: any[], timeframe: RrdTimeframe): RrdRangeMeta {
  const times = (Array.isArray(rows) ? rows : [])
    .map(rowTime)
    .filter((t): t is number => t != null)

  return {
    timeframe,
    stepSeconds: stepSecondsFromRows(rows, timeframe),
    from: times.length ? times[0] : 0,
    to: times.length ? times[times.length - 1] : 0,
    points: times.length,
    truncated: false,
  }
}

/**
 * One-stop resolution of a request: give it the raw query values, it says
 * which timeframe to fetch and how to clip what comes back.
 */
export function resolveRrdRequest(
  rawTimeframe: unknown,
  rawFrom: unknown,
  rawTo: unknown,
  now = nowSeconds(),
): { timeframe: RrdTimeframe; window: RrdWindow | null; truncated: boolean } {
  const requested = parseRrdWindow(rawFrom, rawTo)

  if (!requested) {
    return { timeframe: isRrdTimeframe(rawTimeframe) ? rawTimeframe : 'hour', window: null, truncated: false }
  }

  const { window, truncated } = clampRrdWindow(requested, now)

  return { timeframe: timeframeForWindow(window, now), window, truncated }
}
