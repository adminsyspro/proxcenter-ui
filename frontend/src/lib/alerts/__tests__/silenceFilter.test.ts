import { describe, expect, it } from 'vitest'

import { generateFingerprint } from '@/lib/alerts/fingerprint'
import { buildOrchestratorFingerprint } from '@/lib/alerts/orchestratorFingerprint'
import { isDashboardAlertSilenced, isOrchestratorAlertSilenced } from '@/lib/alerts/silenceFilter'

describe('isOrchestratorAlertSilenced', () => {
  const orchAlert = {
    connection_id: 'conn-abc123',
    type: 'memory',
    severity: 'warning',
    resource_type: 'node',
    resource: 'pve-node-1',
  }

  it('returns false when the silence set is empty', () => {
    expect(isOrchestratorAlertSilenced(orchAlert, new Set())).toBe(false)
  })

  it('returns false when the alert fingerprint is not in the silence set', () => {
    expect(isOrchestratorAlertSilenced(orchAlert, new Set(['some-other-fp']))).toBe(false)
  })

  it('returns true when the alert fingerprint matches a silence', () => {
    const fp = buildOrchestratorFingerprint(orchAlert)
    expect(isOrchestratorAlertSilenced(orchAlert, new Set([fp]))).toBe(true)
  })

  it('uses rule_id in the match (rule-level disambiguation)', () => {
    const ruleA = { ...orchAlert, type: 'event', rule_id: 'rule-A' }
    const ruleB = { ...orchAlert, type: 'event', rule_id: 'rule-B' }
    const silenceOnA = new Set([buildOrchestratorFingerprint(ruleA)])
    expect(isOrchestratorAlertSilenced(ruleA, silenceOnA)).toBe(true)
    // Same alert shape but different rule_id must not match a silence on rule A.
    expect(isOrchestratorAlertSilenced(ruleB, silenceOnA)).toBe(false)
  })
})

describe('isDashboardAlertSilenced', () => {
  const dashAlert = {
    source: 'pve-prod',
    severity: 'warn',
    entityType: 'node',
    entityId: 'pve-node-1',
    metric: 'ram',
  }

  it('returns false when the silence set is empty', () => {
    expect(isDashboardAlertSilenced(dashAlert, new Set())).toBe(false)
  })

  it('returns false when the alert fingerprint is not in the silence set', () => {
    expect(isDashboardAlertSilenced(dashAlert, new Set(['other']))).toBe(false)
  })

  it('returns true when the MD5 fingerprint matches a silence (same contract as /api/v1/alerts/sync)', () => {
    const fp = generateFingerprint({
      source: dashAlert.source,
      severity: dashAlert.severity,
      entityType: dashAlert.entityType,
      entityId: dashAlert.entityId,
      metric: dashAlert.metric,
    })
    expect(isDashboardAlertSilenced(dashAlert, new Set([fp]))).toBe(true)
  })

  it('treats missing source as empty string (matches generateFingerprint default behavior)', () => {
    const alert = { severity: 'crit', entityType: 'storage', entityId: 'local-lvm', metric: 'storage' }
    const fp = generateFingerprint({
      source: '',
      severity: 'crit',
      entityType: 'storage',
      entityId: 'local-lvm',
      metric: 'storage',
    })
    expect(isDashboardAlertSilenced(alert, new Set([fp]))).toBe(true)
  })
})
