import { generateFingerprint } from '@/lib/alerts/fingerprint'
import { buildOrchestratorFingerprint } from '@/lib/alerts/orchestratorFingerprint'

/**
 * Minimal interface for the silence query — matches both the tenant-scoped
 * `getSessionPrisma()` and a bare `prisma` client used by routes that run
 * outside a user session.
 */
interface SilenceQueryClient {
  alertSilence: {
    findMany: (args: {
      where: unknown
      select: { fingerprint: true }
    }) => Promise<Array<{ fingerprint: string }>>
  }
}

/**
 * Loads the set of fingerprints currently muted by an active silence
 * (silencedUntil IS NULL OR silencedUntil > now()). Used by every alerts route
 * that needs to skip muted entries before returning them. Failures (e.g.
 * AlertSilence table missing on a stale schema) resolve to an empty set so
 * the caller silently falls back to un-filtered results.
 */
export async function loadActiveSilenceFingerprints(prisma: SilenceQueryClient): Promise<Set<string>> {
  try {
    const rows = await prisma.alertSilence.findMany({
      where: { OR: [{ silencedUntil: null }, { silencedUntil: { gt: new Date() } }] },
      select: { fingerprint: true },
    })
    return new Set(rows.map(r => r.fingerprint))
  } catch {
    return new Set()
  }
}

/**
 * Returns true if the orchestrator alert (raw shape, before transform into the
 * dashboard shape) is muted via the SHA-256 fingerprint stored by the
 * /operations/alerts mute UI. Single source of truth for the dashboard route's
 * pre-merge filter — same contract as /api/v1/orchestrator/alerts/active.
 */
export function isOrchestratorAlertSilenced(
  orchAlert: {
    connection_id?: string
    type?: string
    severity?: string
    resource?: string
    resource_type?: string
    rule_id?: string
  },
  silencedFingerprints: Set<string>,
): boolean {
  if (silencedFingerprints.size === 0) return false
  return silencedFingerprints.has(buildOrchestratorFingerprint(orchAlert))
}

/**
 * Returns true if the dashboard-evaluated alert (already in dashboard shape:
 * source / severity-short / entityType / entityId / metric) is muted via the
 * MD5 fingerprint stored by /api/v1/alerts/sync. The dashboard route uses this
 * AFTER its orchestrator merge so dashboard-evaluated and merged-orchestrator
 * alerts both honor mutes from their respective UIs.
 */
export function isDashboardAlertSilenced(
  alert: {
    source?: string
    severity?: string
    entityType?: string
    entityId?: string
    metric?: string
  },
  silencedFingerprints: Set<string>,
): boolean {
  if (silencedFingerprints.size === 0) return false
  const fp = generateFingerprint({
    source: alert.source || '',
    severity: alert.severity,
    entityType: alert.entityType,
    entityId: alert.entityId,
    metric: alert.metric,
  })
  return silencedFingerprints.has(fp)
}
