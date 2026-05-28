import { describe, expect, it } from 'vitest'

import { buildOrchestratorFingerprint } from '@/lib/alerts/orchestratorFingerprint'
import { generateFingerprint } from '@/lib/alerts/fingerprint'
import { mergeAndFilterDashboardAlerts } from '@/lib/alerts/dashboardAlertMerge'

const baseLocalAlert = {
  severity: 'warn',
  message: 'Node pve-1 RAM high (85%)',
  source: 'pve-prod',
  sourceType: 'pve',
  entityType: 'node',
  entityId: 'pve-1',
  metric: 'ram',
}

function visibleNodes(names: string[]) {
  return new Set(names)
}

describe('mergeAndFilterDashboardAlerts', () => {
  it('returns local alerts when no orchestrator alerts are provided', () => {
    const result = mergeAndFilterDashboardAlerts({
      baseAlerts: [baseLocalAlert],
      connectionNameById: new Map(),
      visibleNodeNames: visibleNodes(['pve-1']),
      hasVisibleNodes: true,
      silencedFingerprints: new Set(),
    })
    expect(result).toHaveLength(1)
    expect(result[0].entityId).toBe('pve-1')
  })

  it('merges orchestrator alerts that do not duplicate a local alert', () => {
    const orchAlert = {
      connection_id: 'conn-1',
      type: 'cpu',
      severity: 'warning',
      resource_type: 'node',
      resource: 'pve-2',
      message: 'CPU 88%',
    }
    const result = mergeAndFilterDashboardAlerts({
      baseAlerts: [baseLocalAlert],
      orchAlerts: [orchAlert],
      connectionNameById: new Map([['conn-1', 'My Cluster']]),
      visibleNodeNames: visibleNodes(['pve-1', 'pve-2']),
      hasVisibleNodes: true,
      silencedFingerprints: new Set(),
    })
    expect(result.map(a => a.entityId).sort()).toEqual(['pve-1', 'pve-2'])
    const orch = result.find(a => a.entityId === 'pve-2')!
    expect(orch.severity).toBe('warn') // mapped from "warning"
    expect(orch.source).toBe('My Cluster')
    expect(orch.sourceType).toBe('pve')
  })

  it('dedups orchestrator alerts against an existing local alert by (entityType, entityId, metric, severity)', () => {
    const dupOrch = {
      connection_id: 'conn-1',
      type: 'ram',
      severity: 'warn',
      resource_type: 'node',
      resource: 'pve-1',
      message: 'duplicate of baseLocalAlert',
    }
    const result = mergeAndFilterDashboardAlerts({
      baseAlerts: [baseLocalAlert],
      orchAlerts: [dupOrch],
      connectionNameById: new Map(),
      visibleNodeNames: visibleNodes(['pve-1']),
      hasVisibleNodes: true,
      silencedFingerprints: new Set(),
    })
    expect(result).toHaveLength(1)
    expect(result[0].message).toBe(baseLocalAlert.message)
  })

  it('drops orchestrator alerts whose SHA-256 fingerprint is silenced', () => {
    const orchAlert = {
      connection_id: 'conn-1',
      type: 'cpu',
      severity: 'warning',
      resource_type: 'node',
      resource: 'pve-2',
    }
    const silencedFp = buildOrchestratorFingerprint(orchAlert)
    const result = mergeAndFilterDashboardAlerts({
      baseAlerts: [],
      orchAlerts: [orchAlert],
      connectionNameById: new Map(),
      visibleNodeNames: visibleNodes(['pve-2']),
      hasVisibleNodes: true,
      silencedFingerprints: new Set([silencedFp]),
    })
    expect(result).toEqual([])
  })

  it('drops dashboard-evaluated alerts whose MD5 fingerprint is silenced', () => {
    const fp = generateFingerprint({
      source: baseLocalAlert.source,
      severity: baseLocalAlert.severity,
      entityType: baseLocalAlert.entityType,
      entityId: baseLocalAlert.entityId,
      metric: baseLocalAlert.metric,
    })
    const result = mergeAndFilterDashboardAlerts({
      baseAlerts: [baseLocalAlert],
      connectionNameById: new Map(),
      visibleNodeNames: visibleNodes(['pve-1']),
      hasVisibleNodes: true,
      silencedFingerprints: new Set([fp]),
    })
    expect(result).toEqual([])
  })

  it('drops node alerts for nodes not in the visible set', () => {
    const result = mergeAndFilterDashboardAlerts({
      baseAlerts: [baseLocalAlert],
      connectionNameById: new Map(),
      visibleNodeNames: visibleNodes(['pve-99']),
      hasVisibleNodes: true,
      silencedFingerprints: new Set(),
    })
    expect(result).toEqual([])
  })

  it('drops non-node alerts when there are no visible nodes', () => {
    const stormAlert = { ...baseLocalAlert, entityType: 'storage', entityId: 'local-lvm', metric: 'storage' }
    const result = mergeAndFilterDashboardAlerts({
      baseAlerts: [stormAlert],
      connectionNameById: new Map(),
      visibleNodeNames: visibleNodes([]),
      hasVisibleNodes: false,
      silencedFingerprints: new Set(),
    })
    expect(result).toEqual([])
  })

  it('sorts merged alerts by severity (crit → warn → info)', () => {
    const orchCrit = {
      connection_id: 'conn-1',
      type: 'cpu',
      severity: 'critical',
      resource_type: 'node',
      resource: 'pve-2',
    }
    const orchInfo = {
      connection_id: 'conn-1',
      type: 'storage',
      severity: 'info',
      resource_type: 'node',
      resource: 'pve-3',
    }
    const result = mergeAndFilterDashboardAlerts({
      baseAlerts: [baseLocalAlert], // warn on pve-1
      orchAlerts: [orchInfo, orchCrit],
      connectionNameById: new Map(),
      visibleNodeNames: visibleNodes(['pve-1', 'pve-2', 'pve-3']),
      hasVisibleNodes: true,
      silencedFingerprints: new Set(),
    })
    expect(result.map(a => a.severity)).toEqual(['crit', 'warn', 'info'])
  })

  it('falls back to "Orchestrator" as source when connection_id is missing', () => {
    const orphan = { type: 'cpu', severity: 'warn', resource_type: 'node', resource: 'pve-x' }
    const result = mergeAndFilterDashboardAlerts({
      baseAlerts: [],
      orchAlerts: [orphan],
      connectionNameById: new Map(),
      visibleNodeNames: visibleNodes(['pve-x']),
      hasVisibleNodes: true,
      silencedFingerprints: new Set(),
    })
    expect(result[0].source).toBe('pve-x')
  })

  it('handles empty inputs gracefully', () => {
    const result = mergeAndFilterDashboardAlerts({
      baseAlerts: [],
      orchAlerts: [],
      connectionNameById: new Map(),
      visibleNodeNames: visibleNodes([]),
      hasVisibleNodes: false,
      silencedFingerprints: new Set(),
    })
    expect(result).toEqual([])
  })
})
