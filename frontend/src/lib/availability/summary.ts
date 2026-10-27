// src/lib/availability/summary.ts
//
// Summarize of the orchestrator (internal/availability/compute.go) without a
// target, for the per-connection rates of the overview: the query answers one
// summary for all its results, the page needs one per connection.

import type { Result, Summary } from './types'

/** num / den as a percentage, null when den is zero (same as the Go `percent`). */
function percent(num: number, den: number): number | null {
  return den === 0 ? null : (num / den) * 100
}

/** Availability = up / (up + down); coverage = (up + down) / (up + down + unobserved). */
export function summarize(results: readonly Result[]): Summary {
  let up = 0
  let down = 0
  let unobserved = 0
  for (const r of results) {
    up += r.up_seconds
    down += r.down_seconds
    unobserved += r.unobserved_seconds
  }
  const measured = up + down
  return {
    up_seconds: up,
    down_seconds: down,
    unobserved_seconds: unobserved,
    availability: percent(up, measured),
    coverage: percent(measured, measured + unobserved),
    below_target: 0,
    budget: null,
  }
}
