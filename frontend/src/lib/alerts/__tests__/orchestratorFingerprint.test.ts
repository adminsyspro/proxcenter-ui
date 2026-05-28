import crypto from 'crypto'
import { describe, expect, it } from 'vitest'

// This is the canonical contract that backend/internal/alerts/fingerprint.go must
// also implement. Both implementations are tested against the same 6 vectors; any
// drift breaks silence matching between the orchestrator and the UI mute flow.
//
// DO NOT REFACTOR THIS FUNCTION HERE WITHOUT UPDATING:
//   - frontend/src/app/api/v1/orchestrator/alerts/route.ts (l.26-37)
//   - frontend/src/app/api/v1/orchestrator/alerts/summary/route.ts (l.16)
//   - backend/internal/alerts/fingerprint.go (and its tests)
function buildOrchestratorFingerprint(alert: {
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

describe('buildOrchestratorFingerprint (canonical contract)', () => {
  const vectors = [
    { name: 'vector1 node memory warning',       input: { connection_id: 'conn-abc123', type: 'memory',  severity: 'warning',  resource_type: 'node',  resource: 'pve-node-1' }, expected: '575acbec94557a1819409ecbb0cc251b' },
    { name: 'vector2 node memory critical',      input: { connection_id: 'conn-abc123', type: 'memory',  severity: 'critical', resource_type: 'node',  resource: 'pve-node-1' }, expected: 'e078e43ce5591e33de724764b83673bb' },
    { name: 'vector3 vm cpu warning',            input: { connection_id: 'conn-abc123', type: 'cpu',     severity: 'warning',  resource_type: 'vm',    resource: 'my-vm' },      expected: '4687c5f16158d0e0b1eda9e512497569' },
    { name: 'vector4 storage on node',           input: { connection_id: 'conn-abc123', type: 'storage', severity: 'warning',  resource_type: 'node',  resource: 'pve-node-1' }, expected: 'a5a9f0d7ba8311b6dfbb879d0c3b50c3' },
    { name: 'vector5 event with rule',           input: { connection_id: 'conn-abc123', type: 'event',   severity: 'warning',  resource_type: 'event', resource: '100', rule_id: 'rule-uuid-xyz' },   expected: '381423f2e2a93b55a890900ea01503c4' },
    { name: 'vector6 event with different rule', input: { connection_id: 'conn-abc123', type: 'event',   severity: 'warning',  resource_type: 'event', resource: '100', rule_id: 'rule-uuid-OTHER' }, expected: '619999b15c20bc06ce993bf9042de5f3' },
  ] as const

  for (const v of vectors) {
    it(v.name, () => {
      expect(buildOrchestratorFingerprint(v.input)).toBe(v.expected)
    })
  }

  it('rule_id changes the hash', () => {
    const base = { connection_id: 'conn-abc123', type: 'event', severity: 'warning', resource_type: 'event', resource: '100' }
    const a = buildOrchestratorFingerprint({ ...base, rule_id: 'rule-A' })
    const b = buildOrchestratorFingerprint({ ...base, rule_id: 'rule-B' })
    expect(a).not.toBe(b)
  })
})
