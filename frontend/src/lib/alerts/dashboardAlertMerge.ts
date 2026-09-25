import {
  isDashboardAlertSilenced,
  isOrchestratorAlertSilenced,
} from '@/lib/alerts/silenceFilter'

/**
 * Shape of the orchestrator alert as returned by `alertsApi.getAlerts`. Only
 * the fields we read for dedup + fingerprint + transform are typed here.
 */
export interface RawOrchestratorAlert {
  connection_id?: string
  type?: string
  severity?: string
  resource?: string
  resource_id?: number | string
  resource_type?: string
  rule_id?: string
  message?: string
  current_value?: number
  threshold?: number
  unit?: string
  last_seen_at?: string
  created_at?: string
}

/**
 * Dashboard-shape alert: the format `/api/v1/dashboard` returns to the UI. The
 * locally-evaluated alerts already use this shape; orchestrator alerts are
 * transformed into it during merge.
 */
export interface DashboardAlert {
  severity: string
  message: string
  source: string
  sourceType: string
  entityType: string
  entityId: string
  entityName?: string
  connId?: string
  metric?: string
  currentValue?: number
  threshold?: number
  unit?: string
  time?: string
  [key: string]: unknown
}

const SEVERITY_ORDER: Record<string, number> = { crit: 0, warn: 1, info: 2 }

/**
 * The orchestrator names some node metrics differently from the dashboard's
 * own evaluation (`memory` vs `ram`, `node_down` vs `status`). Without this
 * the two shapes of the same alert never matched, so each node alert showed
 * twice and an acknowledgment could not reach the local copy (#1012).
 */
const ORCH_TYPE_TO_DASHBOARD_METRIC: Record<string, string> = {
  memory: 'ram',
  node_down: 'status',
}

function toDashboardSeverity(severity?: string): string {
  if (severity === 'critical') return 'crit'
  if (severity === 'warning') return 'warn'
  return severity || 'info'
}

function orchAlertIdentity(oa: RawOrchestratorAlert): string {
  const metric = (oa.type && ORCH_TYPE_TO_DASHBOARD_METRIC[oa.type]) || oa.type
  return `${oa.resource_type}:${oa.resource_id || oa.resource}:${metric}`
}

function dashboardAlertIdentity(a: DashboardAlert): string {
  return `${a.entityType}:${a.entityId}:${a.metric}`
}

/**
 * Drop the dashboard-evaluated alerts an operator acknowledged in the
 * orchestrator. The acknowledgment covers its severity and below: a local
 * critical stays visible over an acknowledged warning. Both sides carry the
 * connection id, which tells two clusters with the same node name apart.
 */
function dropAcknowledged(alerts: DashboardAlert[], acknowledged: RawOrchestratorAlert[]): DashboardAlert[] {
  if (acknowledged.length === 0) return alerts

  const acked = acknowledged.map(oa => ({
    identity: orchAlertIdentity(oa),
    connId: oa.connection_id,
    rank: SEVERITY_ORDER[toDashboardSeverity(oa.severity)] ?? 2,
  }))

  return alerts.filter(a => {
    const identity = dashboardAlertIdentity(a)
    const rank = SEVERITY_ORDER[a.severity] ?? 2

    return !acked.some(k =>
      k.identity === identity &&
      (!k.connId || !a.connId || k.connId === a.connId) &&
      rank >= k.rank,
    )
  })
}

/**
 * Merge orchestrator alerts into the locally-evaluated dashboard alerts and
 * filter out everything that is muted by an active silence. Single source of
 * truth for the dashboard route's alert pipeline so it stays testable without
 * the route's full upstream graph.
 *
 * - `baseAlerts` are the dashboard-evaluated alerts (already in dashboard shape).
 * - `orchAlerts` are the raw orchestrator alerts; if omitted the merge step
 *   is skipped (Community edition / orchestrator unreachable).
 * - `acknowledgedAlerts` are the orchestrator alerts in `acknowledged` status;
 *   the local copies of those alerts are dropped (#1012).
 * - `silencedFingerprints` comes from `loadActiveSilenceFingerprints`.
 *
 * Two distinct silence checks because the mute UI in /operations/alerts stores
 * the SHA-256 orchestrator-shape fingerprint, while /api/v1/alerts/sync stores
 * the MD5 dashboard-shape fingerprint. A single mute should not have to
 * compute both, so each call site uses the contract that matches the alert it
 * is about to emit.
 */
export function mergeAndFilterDashboardAlerts(params: {
  baseAlerts: DashboardAlert[]
  orchAlerts?: RawOrchestratorAlert[]
  acknowledgedAlerts?: RawOrchestratorAlert[]
  connectionNameById: Map<string, string>
  visibleNodeNames: Set<string>
  hasVisibleNodes: boolean
  silencedFingerprints: Set<string>
}): DashboardAlert[] {
  const {
    baseAlerts,
    orchAlerts,
    acknowledgedAlerts,
    connectionNameById,
    visibleNodeNames,
    hasVisibleNodes,
    silencedFingerprints,
  } = params

  const merged: DashboardAlert[] = dropAcknowledged(baseAlerts, acknowledgedAlerts || [])

  if (orchAlerts && orchAlerts.length > 0) {
    const existingKeys = new Set(
      merged.map(a => `${dashboardAlertIdentity(a)}:${a.severity}`),
    )

    for (const oa of orchAlerts) {
      // Drop muted orchestrator alerts BEFORE the dashboard-shape transform —
      // the SHA-256 fingerprint contract reads orchestrator-native fields.
      if (isOrchestratorAlertSilenced(oa, silencedFingerprints)) continue

      const severity = toDashboardSeverity(oa.severity)
      const key = `${orchAlertIdentity(oa)}:${severity}`
      if (existingKeys.has(key)) continue
      existingKeys.add(key)

      merged.push({
        severity,
        message: oa.message || '',
        source: (oa.connection_id && connectionNameById.get(oa.connection_id)) || oa.resource || 'Orchestrator',
        sourceType: 'pve',
        entityType: oa.resource_type || '',
        entityId: String(oa.resource ?? ''),
        entityName: oa.resource,
        connId: oa.connection_id,
        metric: oa.type,
        currentValue: oa.current_value,
        threshold: oa.threshold,
        unit: oa.unit,
        time: oa.last_seen_at || oa.created_at,
      })
    }

    merged.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2))
  }

  return merged.filter(a => {
    // Visibility filter: nodes must be in the visible set; non-node alerts only
    // pass when there is at least one visible node (matches the pre-PR logic).
    if (a.entityType === 'node' && !visibleNodeNames.has(a.entityId)) return false
    if (a.entityType !== 'node' && !hasVisibleNodes) return false
    // Silence filter for dashboard-evaluated alerts (MD5 contract).
    return !isDashboardAlertSilenced(a, silencedFingerprints)
  })
}
