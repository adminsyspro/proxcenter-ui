/**
 * Display formats for the guest disk I/O figures the orchestrator derives from
 * QEMU block statistics and the guest cgroup (#1011), next to the latency
 * formats of ./latency.
 */

/**
 * A bandwidth in bytes per second, in binary steps with the unit labels the
 * Disk I/O chart axis already uses, so a column and the chart beside it agree.
 * Whole bytes below a kilobyte, one decimal above. An idle disk legitimately
 * reads "0 B/s"; only a figure that is not a rate prints a dash.
 */
export function formatBandwidth(bps: number): string {
  if (!Number.isFinite(bps) || bps < 0) return '—'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let i = 0
  let v = bps

  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }

  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/**
 * An IO pressure stall share: the percentage of the last ten seconds a guest
 * spent waiting on disk I/O, as the kernel's PSI reports it. One decimal, as a
 * healthy guest sits well under 1 % and a whole number would hide the trend.
 */
export function formatPressure(pct: number): string {
  if (!Number.isFinite(pct) || pct < 0) return '—'

  return `${pct.toFixed(1)}%`
}
