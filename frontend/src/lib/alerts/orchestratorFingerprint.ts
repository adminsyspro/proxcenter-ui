import crypto from 'crypto'

/**
 * Build a fingerprint from an orchestrator alert to match against silences
 * and to dedupe within list views.
 *
 * `rule_id` is part of the key: when two rules fire on the same event
 * (e.g. NEW-MSP "test" + CLOUD-MSP "start/stop" both subscribed to vmstart
 * on a shared cluster), the orchestrator stores them as two rows with the
 * same connection/severity/resource. Without rule_id in the fingerprint
 * they'd dedupe into one row and the wrong tenant could end up owning the
 * surviving alert.
 *
 * The Go orchestrator's `OrchestratorFingerprint` (backend/internal/alerts/fingerprint.go)
 * MUST produce identical hex outputs for the same inputs. The canonical
 * vectors in `__tests__/orchestratorFingerprint.test.ts` pin the contract on
 * both sides — any drift here is a silent break of silence matching.
 */
export function buildOrchestratorFingerprint(alert: {
  connection_id?: string
  type?: string
  severity?: string
  resource?: string
  resource_type?: string
  rule_id?: string
}): string {
  const source = alert.connection_id ? `${alert.connection_id}:${alert.type || ''}` : (alert.type || '')
  const data = `${source}|${alert.severity || ''}|${alert.resource_type || ''}|${alert.resource || ''}|${alert.type || ''}|${alert.rule_id || ''}`
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 32)
}
