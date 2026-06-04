export interface PassStat { deltaBytes: number; throughputBytesPerSec: number }
export interface ConvergenceConfig { downtimeBudgetSec: number; maxPasses: number; shutdownSec: number; bootSec: number }
export type ConvergenceDecision =
  | { action: "cutover" }
  | { action: "delta"; pass: number }
  | { action: "operator-gate"; projectedDowntimeSec: number }

/**
 * Decide what to do after a delta pass. The downtime budget governs whether
 * cutover proceeds automatically; maxPasses is only a safety cap. Reaching
 * maxPasses without meeting the budget escalates to an operator decision
 * rather than silently cutting over with a large downtime.
 */
export function decideNextPass(passIndex: number, last: PassStat, cfg: ConvergenceConfig): ConvergenceDecision {
  const transferSec = last.throughputBytesPerSec > 0 ? last.deltaBytes / last.throughputBytesPerSec : Infinity
  const projected = cfg.shutdownSec + cfg.bootSec + transferSec
  if (projected <= cfg.downtimeBudgetSec) return { action: "cutover" }
  if (passIndex + 1 >= cfg.maxPasses) return { action: "operator-gate", projectedDowntimeSec: Math.round(projected) }
  return { action: "delta", pass: passIndex + 1 }
}
