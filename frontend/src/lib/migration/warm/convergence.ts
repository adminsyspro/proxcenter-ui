export interface PassStat { deltaBytes: number; throughputBytesPerSec: number }
export interface ConvergenceConfig { downtimeBudgetSec: number; maxPasses: number; shutdownSec: number; bootSec: number }
export type ConvergenceDecision =
  | { action: "cutover"; projectedDowntimeSec: number }
  | { action: "delta"; pass: number; projectedDowntimeSec: number }
  | { action: "operator-gate"; projectedDowntimeSec: number }

/**
 * Decide what to do after a delta pass. The downtime budget governs whether
 * cutover proceeds automatically; maxPasses is only a safety cap. Reaching
 * maxPasses without meeting the budget escalates to an operator decision
 * rather than silently cutting over with a large downtime.
 */
export function decideNextPass(passIndex: number, last: PassStat, cfg: ConvergenceConfig): ConvergenceDecision {
  // No data left to copy → zero transfer time. Empty/thin VMs copy 0 bytes and
  // report 0 throughput, which must not read as an "infinite" downtime.
  const transferSec = last.deltaBytes <= 0 ? 0 : (last.throughputBytesPerSec > 0 ? last.deltaBytes / last.throughputBytesPerSec : Infinity)
  const projected = cfg.shutdownSec + cfg.bootSec + transferSec
  // Clamp to the projected_downtime_sec column's INTEGER range; an unbounded
  // sentinel would overflow Postgres and fail the migrationJob update.
  const PG_INT_MAX = 2_147_483_647
  const projectedDowntimeSec = Number.isFinite(projected) ? Math.min(Math.round(projected), PG_INT_MAX) : PG_INT_MAX
  if (projected <= cfg.downtimeBudgetSec) return { action: "cutover", projectedDowntimeSec }
  if (passIndex + 1 >= cfg.maxPasses) return { action: "operator-gate", projectedDowntimeSec }
  return { action: "delta", pass: passIndex + 1, projectedDowntimeSec }
}
