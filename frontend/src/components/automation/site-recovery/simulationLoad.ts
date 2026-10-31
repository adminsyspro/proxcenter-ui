/**
 * CPU load of a surviving node once the guests of a failed node have been
 * moved onto it, for the Site Recovery failure simulation.
 *
 * `cpuPercent` is the node's aggregate utilisation in percent (0-100, the
 * inventory's 0-1 `cpu` fraction times 100), so its per-core utilisation is
 * `cpuPercent / 100`. Each added vCPU is assumed to run at that same per-core
 * utilisation. The result is capped at 150 % so an overload stays visible
 * without blowing up the bar.
 */
export function cpuPercentAfterRedistribution(cpuPercent: number, maxcpu: number, addedVcpus: number): number {
  if (!(maxcpu > 0)) return cpuPercent

  const perCore = cpuPercent / 100
  const busyCores = perCore * maxcpu + addedVcpus * perCore

  return Math.min(Math.round((busyCores / maxcpu) * 100), 150)
}
