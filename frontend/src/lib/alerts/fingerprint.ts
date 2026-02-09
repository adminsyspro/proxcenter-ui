import crypto from 'crypto'

/**
 * Generate a unique fingerprint for an alert.
 *
 * Uses stable fields only (source, severity, entityType, entityId, metric).
 * The message is excluded because it often contains variable values (%, counts, etc.)
 * that would create duplicate alerts for the same underlying issue.
 */
export function generateFingerprint(alert: {
  source: string
  severity?: string
  entityType?: string
  entityId?: string
  metric?: string
}): string {
  const data = `${alert.source}|${alert.severity || ''}|${alert.entityType || ''}|${alert.entityId || ''}|${alert.metric || ''}`

  return crypto.createHash('md5').update(data).digest('hex')
}
