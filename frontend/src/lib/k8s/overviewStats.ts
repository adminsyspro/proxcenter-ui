import type { ResourceListItem } from './types'

/** Kinds surfaced as gauges on the explorer Overview tab. */
export const OVERVIEW_KINDS = ['node', 'namespace', 'deployment', 'pod'] as const
export type OverviewKind = (typeof OVERVIEW_KINDS)[number]

export interface KindStat {
  /** Total resources of this kind across all namespaces. */
  total: number
  /** Subset considered healthy (ready / active / fully-replicated). */
  healthy: number
}

/**
 * Interpret an "x/y" ready ratio (as projected by the orchestrator) as complete.
 * "3/3" → true, "0/1" → false, "0/0" → true (nothing desired is trivially ready).
 */
function ratioComplete(raw: string | undefined): boolean {
  if (!raw) return false
  const parts = raw.split('/')
  if (parts.length !== 2) return false
  const ready = parseInt(parts[0], 10)
  const desired = parseInt(parts[1], 10)
  if (Number.isNaN(ready) || Number.isNaN(desired)) return false
  return ready >= desired
}

function isHealthy(kind: OverviewKind, item: ResourceListItem): boolean {
  const s = item.summary || {}
  switch (kind) {
    case 'node':
      return s.ready === 'True'
    case 'namespace':
      return s.phase === 'Active'
    case 'deployment':
    case 'pod':
      return ratioComplete(s.ready)
    default:
      return false
  }
}

/** Reduce a resource list into a {total, healthy} stat for an overview gauge. */
export function computeKindStat(kind: OverviewKind, items: ResourceListItem[]): KindStat {
  let healthy = 0
  for (const it of items) {
    if (isHealthy(kind, it)) healthy++
  }
  return { total: items.length, healthy }
}

/**
 * Gauge colour from a stat: green when fully healthy, amber when degraded,
 * red when mostly down, grey when empty or not yet loaded. Thresholds mirror
 * the dashboard node-score palette for product consistency.
 */
export function healthRatioColor(stat: KindStat | null): string {
  if (!stat || stat.total === 0) return '#9e9e9e'
  const pct = (stat.healthy / stat.total) * 100
  if (pct >= 80) return '#4caf50'
  if (pct >= 50) return '#ff9800'
  return '#f44336'
}
