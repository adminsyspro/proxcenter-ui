// Shared lease day-count math (A8, roadmap#22 lot 4 wave 2). The portal
// InstancesCard and the orchestrator's lease_days_remaining use the same
// formula: a lease renewed minutes ago must still show its full day count,
// and a lease that just ran out must never read "0 days" as if it still had
// time left.
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// Returns null when there is no date to show or the lease already ended
// (ms <= 0), 0 for "less than a day" left, otherwise the whole number of
// days left, rounded up by one hour so a lease issued minutes ago keeps its
// full count instead of losing a day to processing delay.
export function leaseDaysLeft(until, now = Date.now()) {
  if (!until) return null

  const ms = new Date(until).getTime() - now

  if (!Number.isFinite(ms) || ms <= 0) return null
  if (ms < DAY_MS) return 0

  return Math.floor((ms + HOUR_MS) / DAY_MS)
}
