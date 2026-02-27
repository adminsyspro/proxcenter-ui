export type DrsHealthBreakdown = {
  avgMem: number
  memPenalty: number
  avgCpu: number
  cpuPenalty: number
  imbalance: number
  imbalancePenalty: number
  memSpread: number
  memSpreadPenalty: number
  cpuSpread: number
  cpuSpreadPenalty: number
  score: number
}

const EMPTY_BREAKDOWN: DrsHealthBreakdown = {
  avgMem: 0, memPenalty: 0, avgCpu: 0, cpuPenalty: 0,
  imbalance: 0, imbalancePenalty: 0,
  memSpread: 0, memSpreadPenalty: 0, cpuSpread: 0, cpuSpreadPenalty: 0,
  score: 100,
}

export function computeDrsHealthScore(
  summary: { avg_memory_usage?: number; avg_cpu_usage?: number; imbalance?: number } | null | undefined,
  nodes?: { memory_usage: number; cpu_usage: number; status?: string }[] | null
): DrsHealthBreakdown {
  if (!summary) return { ...EMPTY_BREAKDOWN }

  const avgMem = summary.avg_memory_usage ?? 0
  const avgCpu = summary.avg_cpu_usage ?? 0
  const imbalance = summary.imbalance ?? 0
  let score = 100

  // --- Per-node spread penalties (primary signal) ---
  let memSpread = 0
  let memSpreadPenalty = 0
  let cpuSpread = 0
  let cpuSpreadPenalty = 0

  const onlineNodes = nodes?.filter(n => !n.status || n.status === 'online') ?? []
  if (onlineNodes.length >= 2) {
    const memValues = onlineNodes.map(n => n.memory_usage)
    memSpread = Math.max(...memValues) - Math.min(...memValues)

    if (memSpread > 30) memSpreadPenalty = -35
    else if (memSpread > 20) memSpreadPenalty = -25
    else if (memSpread > 10) memSpreadPenalty = -15
    else if (memSpread > 5) memSpreadPenalty = -5

    const cpuValues = onlineNodes.map(n => n.cpu_usage)
    cpuSpread = Math.max(...cpuValues) - Math.min(...cpuValues)

    if (cpuSpread > 40) cpuSpreadPenalty = -15
    else if (cpuSpread > 20) cpuSpreadPenalty = -10
    else if (cpuSpread > 10) cpuSpreadPenalty = -5
  }

  score += memSpreadPenalty + cpuSpreadPenalty

  // --- Resource pressure penalties (secondary) ---
  let memPenalty = 0
  if (avgMem > 85) memPenalty = -10
  else if (avgMem > 75) memPenalty = -5
  score += memPenalty

  let cpuPenalty = 0
  if (avgCpu > 80) cpuPenalty = -5
  else if (avgCpu > 65) cpuPenalty = -3
  score += cpuPenalty

  // --- CV imbalance penalty (minor tiebreaker) ---
  let imbalancePenalty = 0
  if (imbalance > 10) imbalancePenalty = -5
  else if (imbalance > 5) imbalancePenalty = -3
  score += imbalancePenalty

  return {
    avgMem, memPenalty, avgCpu, cpuPenalty,
    imbalance, imbalancePenalty,
    memSpread, memSpreadPenalty, cpuSpread, cpuSpreadPenalty,
    score: Math.max(0, score),
  }
}
