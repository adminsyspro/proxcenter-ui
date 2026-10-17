// Rate limit of the thick-target zeroing that precedes a warm copy (roadmap#45).
//
// Shared by the warm dialog (field validation), the migrations route (payload
// validation), the connection dialog (cap of a PVE target) and the engine (slice size),
// so every surface agrees on the unit and the bounds. No React, no server code:
// importable from both sides.

/** Unit shown to the operator: 1 MB/s = 1 MiB/s, like every throughput line of the job log. */
export const ZERO_RATE_MIB = 1024 * 1024

/** 0 means "no limit": the engine zeroes as fast as the array accepts, the historical behaviour. */
export const ZERO_RATE_UNLIMITED = 0
export const ZERO_RATE_LIMIT_MIN_MBPS = 1
export const ZERO_RATE_LIMIT_MAX_MBPS = 100_000

/**
 * Parse a rate limit coming from the UI or a raw API caller. Returns the value
 * (0 = unlimited), or null when it is not an integer within bounds. `undefined`,
 * `null` and `""` mean "not set" and come back as undefined so the caller can
 * fall back to the target connection's cap.
 */
export function parseZeroRateLimit(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined
  // Strings must be plain digits: "1e3" or "12.5" typed in the dialog are a
  // mistake to flag, not a value to coerce.
  if (typeof raw !== "number" && !/^\d+$/.test(String(raw).trim())) return null
  const n = typeof raw === "number" ? raw : Number(String(raw).trim())
  if (!Number.isInteger(n)) return null
  if (n === ZERO_RATE_UNLIMITED) return n
  return n >= ZERO_RATE_LIMIT_MIN_MBPS && n <= ZERO_RATE_LIMIT_MAX_MBPS ? n : null
}

/** The dialog field: empty means "use the target connection's cap", anything else must parse. */
export function isZeroRateLimitValid(value: string): boolean {
  return parseZeroRateLimit(value.trim()) !== null
}

/**
 * Slider of the cap in the UI (connection and migration dialogs). A field
 * report saw an offload at 1.6 GB/s saturate a shared LUN, so the useful range
 * sits below 2 GB/s; a larger value set through the API shows pinned at the end.
 */
export const ZERO_RATE_SLIDER_MAX = 2000
export const ZERO_RATE_SLIDER_STEP = 50
export const ZERO_RATE_SLIDER_MARKS = [0, 500, 1000, 1500, 2000]

/** Largest slice the engine zeroes in one `blkdiscard -z` / dd round, whatever the cap. */
export const ZERO_SLICE_MAX_BYTES = 1024 * ZERO_RATE_MIB
/** Every slice is a multiple of this, so the O_DIRECT dd fallback writes aligned blocks. */
export const ZERO_SLICE_ALIGN_BYTES = 4 * ZERO_RATE_MIB

/**
 * Bytes zeroed per slice for a cap in bytes per second (0 = unlimited).
 *
 * Unlimited: 1 GiB slices, enough for a progress line every second or two on
 * the arrays that offload, and a few seconds apart on the streamed path.
 * Capped: about a quarter second of the allowed rate per slice, so the array
 * sees short bursts with idle gaps rather than one saturating stream per
 * second, never below one 4 MiB block nor above the unlimited slice.
 */
export function zeroSliceBytes(capBytesPerSec: number): number {
  if (!(capBytesPerSec > 0)) return ZERO_SLICE_MAX_BYTES
  const quarter = Math.floor(capBytesPerSec / 4 / ZERO_SLICE_ALIGN_BYTES) * ZERO_SLICE_ALIGN_BYTES
  return Math.min(ZERO_SLICE_MAX_BYTES, Math.max(ZERO_SLICE_ALIGN_BYTES, quarter))
}

/** "unlimited" or "250 MB/s", for job log lines and helper texts. */
export function describeZeroRateLimit(mbps: number | undefined | null): string {
  return mbps && mbps > 0 ? `${mbps} MB/s` : "unlimited"
}
