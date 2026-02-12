import type { KpiData, PredictiveAlert, ResourceThresholds } from '../types'
import { DEFAULT_THRESHOLDS } from '../constants'

export function calculateHealthScore(
  kpis: KpiData,
  alerts: PredictiveAlert[],
  thresholds: ResourceThresholds = DEFAULT_THRESHOLDS,
): number {
  let score = 100

  // ===== CPU (max -20 points) =====
  if (kpis.cpu.used > thresholds.cpu.critical) score -= 20
  else if (kpis.cpu.used > thresholds.cpu.warning) score -= 15
  else if (kpis.cpu.used > 70) score -= 8
  else if (kpis.cpu.used > 60) score -= 4
  else if (kpis.cpu.used < 5) score -= 5
  else if (kpis.cpu.used < 10) score -= 2

  // ===== RAM (max -25 points) =====
  if (kpis.ram.used > thresholds.ram.critical) score -= 25
  else if (kpis.ram.used > thresholds.ram.warning) score -= 18
  else if (kpis.ram.used > 80) score -= 12
  else if (kpis.ram.used > 75) score -= 6
  else if (kpis.ram.used < 20) score -= 8
  else if (kpis.ram.used < 30) score -= 4

  // ===== Storage (max -25 points) =====
  const storagePct = kpis.storage.total > 0 ? (kpis.storage.used / kpis.storage.total) * 100 : 0

  if (storagePct > thresholds.storage.critical + 5) score -= 25
  else if (storagePct > thresholds.storage.critical) score -= 20
  else if (storagePct > thresholds.storage.warning + 5) score -= 15
  else if (storagePct > thresholds.storage.warning) score -= 10
  else if (storagePct > 75) score -= 5

  // ===== Predictive alerts (max -30 points) =====
  let alertPenalty = 0
  alerts.forEach(alert => {
    if (alert.severity === 'critical') alertPenalty += 12
    else if (alert.severity === 'warning') alertPenalty += 5
  })
  score -= Math.min(30, alertPenalty)

  // ===== Efficiency (max -15 / +5 points) =====
  if (kpis.efficiency >= 80) score += 5
  else if (kpis.efficiency >= 70) score += 2
  else if (kpis.efficiency < 30) score -= 15
  else if (kpis.efficiency < 40) score -= 10
  else if (kpis.efficiency < 50) score -= 5

  // ===== Stopped VMs (max -10 points) =====
  const stoppedRatio = kpis.vms.total > 0 ? kpis.vms.stopped / kpis.vms.total : 0
  if (stoppedRatio > 0.4) score -= 10
  else if (stoppedRatio > 0.3) score -= 7
  else if (stoppedRatio > 0.25) score -= 4
  else if (stoppedRatio > 0.2) score -= 2

  return Math.max(0, Math.min(100, Math.round(score)))
}
