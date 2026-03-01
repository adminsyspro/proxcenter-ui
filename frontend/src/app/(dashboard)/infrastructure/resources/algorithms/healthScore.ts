import type { KpiData, PredictiveAlert, ResourceThresholds } from '../types'
import { DEFAULT_THRESHOLDS } from '../constants'

export type HealthScoreBreakdown = {
  cpu: { penalty: number; reason: string }
  ram: { penalty: number; reason: string }
  storage: { penalty: number; reason: string }
  alerts: { penalty: number; reason: string }
  efficiency: { penalty: number; reason: string }
  stoppedVms: { penalty: number; reason: string }
}

export function calculateHealthScoreWithDetails(
  kpis: KpiData,
  alerts: PredictiveAlert[],
  thresholds: ResourceThresholds = DEFAULT_THRESHOLDS,
): { score: number; breakdown: HealthScoreBreakdown } {
  let score = 100
  const breakdown: HealthScoreBreakdown = {
    cpu: { penalty: 0, reason: '' },
    ram: { penalty: 0, reason: '' },
    storage: { penalty: 0, reason: '' },
    alerts: { penalty: 0, reason: '' },
    efficiency: { penalty: 0, reason: '' },
    stoppedVms: { penalty: 0, reason: '' },
  }

  // ===== CPU (max -20 points) =====
  const cpuPct = Math.round(kpis.cpu.used)
  if (kpis.cpu.used > thresholds.cpu.critical) { breakdown.cpu = { penalty: -20, reason: `${cpuPct}% > ${thresholds.cpu.critical}% (critical)` } }
  else if (kpis.cpu.used > thresholds.cpu.warning) { breakdown.cpu = { penalty: -15, reason: `${cpuPct}% > ${thresholds.cpu.warning}% (warning)` } }
  else if (kpis.cpu.used > 70) { breakdown.cpu = { penalty: -8, reason: `${cpuPct}% > 70%` } }
  else if (kpis.cpu.used > 60) { breakdown.cpu = { penalty: -4, reason: `${cpuPct}% > 60%` } }
  else if (kpis.cpu.used < 5) { breakdown.cpu = { penalty: -5, reason: `${cpuPct}% < 5% (underused)` } }
  else if (kpis.cpu.used < 10) { breakdown.cpu = { penalty: -2, reason: `${cpuPct}% < 10% (underused)` } }
  else { breakdown.cpu = { penalty: 0, reason: `${cpuPct}% OK` } }
  score += breakdown.cpu.penalty

  // ===== RAM (max -25 points) =====
  const ramPct = Math.round(kpis.ram.used)
  if (kpis.ram.used > thresholds.ram.critical) { breakdown.ram = { penalty: -25, reason: `${ramPct}% > ${thresholds.ram.critical}% (critical)` } }
  else if (kpis.ram.used > thresholds.ram.warning) { breakdown.ram = { penalty: -18, reason: `${ramPct}% > ${thresholds.ram.warning}% (warning)` } }
  else if (kpis.ram.used > 80) { breakdown.ram = { penalty: -12, reason: `${ramPct}% > 80%` } }
  else if (kpis.ram.used > 75) { breakdown.ram = { penalty: -6, reason: `${ramPct}% > 75%` } }
  else if (kpis.ram.used < 20) { breakdown.ram = { penalty: -8, reason: `${ramPct}% < 20% (underused)` } }
  else if (kpis.ram.used < 30) { breakdown.ram = { penalty: -4, reason: `${ramPct}% < 30% (underused)` } }
  else { breakdown.ram = { penalty: 0, reason: `${ramPct}% OK` } }
  score += breakdown.ram.penalty

  // ===== Storage (max -25 points) =====
  const storagePct = kpis.storage.total > 0 ? (kpis.storage.used / kpis.storage.total) * 100 : 0
  const storagePctRound = Math.round(storagePct)
  if (storagePct > thresholds.storage.critical + 5) { breakdown.storage = { penalty: -25, reason: `${storagePctRound}% > ${thresholds.storage.critical + 5}% (critical+)` } }
  else if (storagePct > thresholds.storage.critical) { breakdown.storage = { penalty: -20, reason: `${storagePctRound}% > ${thresholds.storage.critical}% (critical)` } }
  else if (storagePct > thresholds.storage.warning + 5) { breakdown.storage = { penalty: -15, reason: `${storagePctRound}% > ${thresholds.storage.warning + 5}%` } }
  else if (storagePct > thresholds.storage.warning) { breakdown.storage = { penalty: -10, reason: `${storagePctRound}% > ${thresholds.storage.warning}%` } }
  else if (storagePct > 75) { breakdown.storage = { penalty: -5, reason: `${storagePctRound}% > 75%` } }
  else { breakdown.storage = { penalty: 0, reason: `${storagePctRound}% OK` } }
  score += breakdown.storage.penalty

  // ===== Predictive alerts (max -30 points) =====
  let alertPenalty = 0
  const critCount = alerts.filter(a => a.severity === 'critical').length
  const warnCount = alerts.filter(a => a.severity === 'warning').length
  alerts.forEach(alert => {
    if (alert.severity === 'critical') alertPenalty += 12
    else if (alert.severity === 'warning') alertPenalty += 5
  })
  const cappedPenalty = Math.min(30, alertPenalty)
  breakdown.alerts = {
    penalty: -cappedPenalty,
    reason: cappedPenalty === 0 ? 'No alerts' : `${critCount} critical, ${warnCount} warning`,
  }
  score -= cappedPenalty

  // ===== Efficiency (max -15 / +5 points) =====
  const eff = kpis.efficiency
  if (eff >= 80) { breakdown.efficiency = { penalty: 5, reason: `${eff}% (excellent)` } }
  else if (eff >= 70) { breakdown.efficiency = { penalty: 2, reason: `${eff}% (good)` } }
  else if (eff < 30) { breakdown.efficiency = { penalty: -15, reason: `${eff}% < 30%` } }
  else if (eff < 40) { breakdown.efficiency = { penalty: -10, reason: `${eff}% < 40%` } }
  else if (eff < 50) { breakdown.efficiency = { penalty: -5, reason: `${eff}% < 50%` } }
  else { breakdown.efficiency = { penalty: 0, reason: `${eff}%` } }
  score += breakdown.efficiency.penalty

  // ===== Stopped VMs — no penalty (stopped VMs are normal: templates, standby, dev, etc.) =====
  breakdown.stoppedVms = { penalty: 0, reason: '' }

  return { score: Math.max(0, Math.min(100, Math.round(score))), breakdown }
}

// Backward compat
export function calculateHealthScore(
  kpis: KpiData,
  alerts: PredictiveAlert[],
  thresholds: ResourceThresholds = DEFAULT_THRESHOLDS,
): number {
  return calculateHealthScoreWithDetails(kpis, alerts, thresholds).score
}
