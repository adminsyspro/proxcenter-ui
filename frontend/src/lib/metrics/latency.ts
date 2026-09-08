/**
 * Formats a guest disk latency for display (#881).
 *
 * Latencies are milliseconds per I/O. Below one millisecond a whole number
 * would print "0 ms" for a healthy NVMe disk, so one decimal is kept there;
 * above it the decimal is noise next to thresholds set in whole milliseconds.
 */
export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1) return `${ms.toFixed(1)} ms`
  return `${Math.round(ms)} ms`
}

/**
 * Axis variant: a chart whose whole range sits under a millisecond gets ticks
 * at 0.05 ms steps, which the one-decimal display would print as duplicates
 * ("0.1 ms" twice). Two significant decimals below 1 ms, whole numbers above.
 */
export function formatLatencyAxis(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1) return `${Number(ms.toFixed(2))} ms`
  return `${Math.round(ms)} ms`
}
