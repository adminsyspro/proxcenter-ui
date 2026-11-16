// Cap on the read side of a warm copy, in MB/s, so a copy does not take the
// whole link or the source datastores in production hours.
//
// The cap is enforced by nbdkit's rate filter in front of each reader on the
// PVE node (VDDK for VMware, NBD for XCP-ng); the engine rewrites the filter's
// rate file when the share of a copy changes (copy-rate-governor). Shared by
// the dialogs (field validation), the routes (payload validation) and the
// engine, so every surface agrees on the unit and the bounds. No React, no
// server code: importable from both sides.

/** Same unit as every throughput line of the job log: 1 MB/s = 1 MiB/s. */
export const COPY_RATE_MIB = 1024 * 1024
/** 0 means "no cap". */
export const COPY_RATE_UNLIMITED = 0
export const COPY_RATE_MIN_MBPS = 1
export const COPY_RATE_MAX_MBPS = 100_000
/** Slider range of the dialogs; the field takes any value up to COPY_RATE_MAX_MBPS. */
export const COPY_RATE_SLIDER_MAX = 1000
export const COPY_RATE_SLIDER_STEP = 10
export const COPY_RATE_SLIDER_MARKS = [0, 250, 500, 750, 1000]

/**
 * Hours of the day where `mbps` applies; `offHoursMbps` applies the rest of
 * the time. `from` and `to` are HH:MM in the `tz` time zone (the operator's
 * browser), a window that ends before it starts runs over midnight, and an
 * empty window (from == to) means all day.
 */
export interface CopyRateSchedule {
  from: string
  to: string
  tz: string
  offHoursMbps: number
}

export interface CopyRateLimit {
  mbps: number
  schedule?: CopyRateSchedule
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function isMbps(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v)
    && (v === COPY_RATE_UNLIMITED || (v >= COPY_RATE_MIN_MBPS && v <= COPY_RATE_MAX_MBPS))
}

function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * Parse a cap from the UI or a raw API caller. `undefined` and `null` mean
 * "not set" and come back as undefined; anything that is not a valid cap
 * comes back as null so the caller can answer 400.
 */
export function parseCopyRateLimit(raw: unknown): CopyRateLimit | null | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== "object" || Array.isArray(raw)) return null
  const { mbps, schedule } = raw as { mbps?: unknown; schedule?: unknown }
  if (!isMbps(mbps)) return null
  if (schedule === undefined || schedule === null) return { mbps }
  if (typeof schedule !== "object" || Array.isArray(schedule)) return null
  const s = schedule as Record<string, unknown>
  if (typeof s.from !== "string" || !HHMM_RE.test(s.from)) return null
  if (typeof s.to !== "string" || !HHMM_RE.test(s.to)) return null
  if (!isTimeZone(s.tz) || !isMbps(s.offHoursMbps)) return null
  return { mbps, schedule: { from: s.from, to: s.to, tz: s.tz, offHoursMbps: s.offHoursMbps } }
}

function minutesOf(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
}

function minutesInZone(now: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now)
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0)
  return get("hour") * 60 + get("minute")
}

/** The cap in force at `now` (0 = unlimited). */
export function copyRateAt(limit: CopyRateLimit | null | undefined, now: Date): number {
  if (!limit) return COPY_RATE_UNLIMITED
  const s = limit.schedule
  if (!s) return limit.mbps
  const from = minutesOf(s.from)
  const to = minutesOf(s.to)
  if (from === to) return limit.mbps
  let m: number
  try {
    m = minutesInZone(now, s.tz)
  } catch {
    return limit.mbps
  }
  const inside = from < to ? m >= from && m < to : m >= from || m < to
  return inside ? limit.mbps : s.offHoursMbps
}

/**
 * The share of one copy: each cap is split evenly between the copies it
 * covers, and the smallest share wins. Never below 1 MB/s (0 would read as
 * unlimited); 0 when no cap applies.
 */
export function copyRateShare(caps: Array<{ mbps: number; copies: number }>): number {
  let share = COPY_RATE_UNLIMITED
  for (const c of caps) {
    if (!(c.mbps > 0)) continue
    const part = Math.max(COPY_RATE_MIN_MBPS, Math.floor(c.mbps / Math.max(1, c.copies)))
    share = share === COPY_RATE_UNLIMITED ? part : Math.min(share, part)
  }
  return share
}

/** nbdkit's rate filter counts bits, its "M" being 2^20: 50 MB/s is "400M". */
export function nbdkitRateArg(mbps: number): string {
  return mbps > 0 ? `${Math.floor(mbps) * 8}M` : "0"
}

/** "unlimited" or "50 MB/s", for job log lines. */
export function describeCopyRate(mbps: number): string {
  return mbps > 0 ? `${mbps} MB/s` : "unlimited"
}

/**
 * Every pass reads under the cap but the final cutover one: the source is off
 * and every second there is downtime. The catch-up before it (source still on)
 * stays capped.
 */
export function isCappedPass(currentStep: string): boolean {
  return currentStep !== "cutover"
}

/** Former fixed budget of an apply command, kept as the floor. */
const APPLY_BASE_TIMEOUT_MS = 12 * 60 * 60 * 1000

/**
 * Budget of one apply command: 12 h plus its bytes at the lowest cap
 * (1 MB/s), so a capped copy of a large disk is not cut off midway. The
 * inactivity guard stays the protection against a copy that stalls.
 */
export function applyTimeoutMs(scriptBytes: number): number {
  const bytes = Number.isFinite(scriptBytes) && scriptBytes > 0 ? scriptBytes : 0
  return APPLY_BASE_TIMEOUT_MS + Math.ceil(bytes / (COPY_RATE_MIN_MBPS * COPY_RATE_MIB)) * 1000
}

/** The part of a migration or batch request that carries the cap: warm only, nothing without a cap. */
export function copyRatePayload(migrationType: string, limit: CopyRateLimit | null): { copyRateLimit?: CopyRateLimit } {
  return migrationType === "warm" && limit ? { copyRateLimit: limit } : {}
}
