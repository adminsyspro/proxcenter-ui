export type DrsHealthBreakdown = {
  avgMem: number
  memPenalty: number
  avgCpu: number
  cpuPenalty: number
  imbalance: number
  imbalancePenalty: number
  score: number
}

export function computeDrsHealthScore(
  summary: { avg_memory_usage?: number; avg_cpu_usage?: number; imbalance?: number } | null | undefined
): DrsHealthBreakdown {
  if (!summary) return { avgMem: 0, memPenalty: 0, avgCpu: 0, cpuPenalty: 0, imbalance: 0, imbalancePenalty: 0, score: 100 }

  const avgMem = summary.avg_memory_usage ?? 0
  const avgCpu = summary.avg_cpu_usage ?? 0
  const imbalance = summary.imbalance ?? 0
  let score = 100

  let memPenalty = 0
  if (avgMem > 85) memPenalty = -30
  else if (avgMem > 70) memPenalty = -15
  score += memPenalty

  let cpuPenalty = 0
  if (avgCpu > 80) cpuPenalty = -20
  else if (avgCpu > 60) cpuPenalty = -10
  score += cpuPenalty

  let imbalancePenalty = 0
  if (imbalance > 10) imbalancePenalty = -20
  else if (imbalance > 5) imbalancePenalty = -10
  score += imbalancePenalty

  return { avgMem, memPenalty, avgCpu, cpuPenalty, imbalance, imbalancePenalty, score: Math.max(0, score) }
}
