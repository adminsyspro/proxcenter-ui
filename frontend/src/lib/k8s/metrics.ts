import type { NodeUtilization } from './types'

export const MODERATE_UTIL = 70
export const HIGH_UTIL = 90
export const NODE_UTIL_LIMIT = 12 // cap rendered per-node rows (mirrors NODE_BARS_LIMIT); rest folded into "+N more" by the component

export interface UtilBar { name: string; cpuPct: number; memPct: number }
export interface ClusterUtil {
  cpuPct: number; memPct: number
  cpuUsedMilli: number; cpuAllocMilli: number
  memUsedBytes: number; memAllocBytes: number
}

export function pct(used: number, alloc: number): number {
  // Written as a positive test so a NaN alloc also yields 0.
  if (alloc > 0) {
    const p = Math.round((used / alloc) * 100)
    return Math.max(0, Math.min(100, p))
  }
  return 0
}

export function clusterUtilization(nodes: NodeUtilization[]): ClusterUtil {
  let cpuUsedMilli = 0, cpuAllocMilli = 0, memUsedBytes = 0, memAllocBytes = 0
  for (const n of nodes) {
    cpuUsedMilli += n.cpuUsedMilli
    cpuAllocMilli += n.cpuAllocMilli
    memUsedBytes += n.memUsedBytes
    memAllocBytes += n.memAllocBytes
  }
  return {
    cpuPct: pct(cpuUsedMilli, cpuAllocMilli),
    memPct: pct(memUsedBytes, memAllocBytes),
    cpuUsedMilli, cpuAllocMilli, memUsedBytes, memAllocBytes,
  }
}

export function perNodeUtilization(nodes: NodeUtilization[]): UtilBar[] {
  return nodes
    .map(n => ({ name: n.name, cpuPct: pct(n.cpuUsedMilli, n.cpuAllocMilli), memPct: pct(n.memUsedBytes, n.memAllocBytes) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Order per-node bars by aggregate utilisation (CPU% + RAM%) descending, so the
// busiest nodes surface first and survive the display cap. Name breaks ties for
// a stable order. Returns a new array (does not mutate the input).
export function sortNodesByUsage(bars: UtilBar[]): UtilBar[] {
  return [...bars].sort(
    (a, b) => (b.cpuPct + b.memPct) - (a.cpuPct + a.memPct) || a.name.localeCompare(b.name),
  )
}

export function utilizationColor(p: number): string {
  if (p > HIGH_UTIL) return '#f44336'      // red
  if (p >= MODERATE_UTIL) return '#ff9800' // amber
  return '#4caf50'                          // green
}

// Continuous green→amber→red color for a utilization percent (0..100).
// Hue goes from 120 (green) at 0% down to 0 (red) at 100%, passing through
// yellow/orange mid-range, so the colour tracks the value instead of stepping
// at fixed thresholds. Used for the cluster donuts and the end of the per-node
// bar gradient (see UTIL_GRADIENT_CSS) so both stay visually consistent.
export function utilizationGradientColor(p: number): string {
  const clamped = Math.max(0, Math.min(100, p))
  const hue = 120 - (clamped / 100) * 120
  return `hsl(${Math.round(hue)}, 70%, 45%)`
}

// CSS background for a green→red utilization bar; endpoints match
// utilizationGradientColor(0) and utilizationGradientColor(100).
export const UTIL_GRADIENT_CSS =
  'linear-gradient(90deg, hsl(120,70%,45%) 0%, hsl(60,70%,45%) 50%, hsl(0,70%,45%) 100%)'

export function formatCores(milli: number): string {
  if (milli < 1000) return `${milli}m`
  return (milli / 1000).toFixed(1)
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
