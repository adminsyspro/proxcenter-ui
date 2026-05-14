// Insight detection for the per-VM Green Score card.
//
// Pure function, no I/O. Priority order (first match wins, only one
// insight surfaced):
//   1. idle_cpu       : avg CPU < 10% AND running ratio > 0.5
//   2. oversized_ram  : avg mem  < 30% AND running ratio > 0.5
//   3. mostly_stopped : running ratio < 0.3
//   4. efficient_dc   : PUE <= 1.2
// Returns null when nothing matches.

export type InsightKind =
  | 'idle_cpu'
  | 'oversized_ram'
  | 'mostly_stopped'
  | 'efficient_dc'

export interface InsightInput {

  /** Average CPU usage across running samples, 0..100. */
  avgCpuPct: number

  /** Average RAM usage / maxmem across running samples, 0..100. */
  avgMemPct: number

  /** Share of samples where the VM was active, 0..1. */
  runningRatio: number

  /** Datacentre PUE applied to this VM. */
  pue: number

  /** Current vCPU allocation of the VM. */
  maxcpu: number
}

export interface Insight {
  kind: InsightKind
  severity: 'warning' | 'info' | 'success'
  titleKey: string
  suggestionKey: string
  placeholders: Record<string, string | number>
}

export function detectInsight(input: InsightInput): Insight | null {
  const { avgCpuPct, avgMemPct, runningRatio, pue, maxcpu } = input

  if (avgCpuPct < 10 && runningRatio > 0.5) {
    const suggestedVcpus = Math.max(1, Math.ceil(maxcpu * 0.4))


return {
      kind: 'idle_cpu',
      severity: 'warning',
      titleKey: 'green.insights.idleCpu.title',
      suggestionKey: 'green.insights.idleCpu.suggestion',
      placeholders: { cpu: Math.round(avgCpuPct), suggestedVcpus },
    }
  }

  if (avgMemPct < 30 && runningRatio > 0.5) {
    return {
      kind: 'oversized_ram',
      severity: 'warning',
      titleKey: 'green.insights.oversizedRam.title',
      suggestionKey: 'green.insights.oversizedRam.suggestion',
      placeholders: { memPct: Math.round(avgMemPct) },
    }
  }

  if (runningRatio < 0.3) {
    const offPct = Math.round((1 - runningRatio) * 100)


return {
      kind: 'mostly_stopped',
      severity: 'info',
      titleKey: 'green.insights.mostlyStopped.title',
      suggestionKey: 'green.insights.mostlyStopped.suggestion',
      placeholders: { offPct },
    }
  }

  if (pue <= 1.2) {
    return {
      kind: 'efficient_dc',
      severity: 'success',
      titleKey: 'green.insights.efficientDc.title',
      suggestionKey: 'green.insights.efficientDc.suggestion',
      placeholders: { pue: pue.toFixed(2) },
    }
  }

  return null
}
