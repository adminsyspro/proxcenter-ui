import { describe, expect, it } from 'vitest'

import { buildOrchestratorFingerprint } from '../orchestratorFingerprint'

// Canonical contract pinned across both repos. The Go side
// (backend/internal/alerts/fingerprint.go) MUST produce identical hex outputs
// for the same inputs — see its own canonical vector tests. Any drift here
// silently breaks silence matching between the orchestrator and the UI mute flow.

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

  it('falls back to type alone when connection_id is absent', () => {
    // Exercises the ternary's falsy branch: source = type instead of `${cid}:${type}`.
    const withCid = buildOrchestratorFingerprint({ connection_id: 'c', type: 'cpu', severity: 'warning', resource_type: 'node', resource: 'n' })
    const withoutCid = buildOrchestratorFingerprint({ type: 'cpu', severity: 'warning', resource_type: 'node', resource: 'n' })
    expect(withCid).not.toBe(withoutCid)
    // Both should be 32-char hex.
    expect(withoutCid).toMatch(/^[0-9a-f]{32}$/)
  })

  it('coerces undefined fields to empty strings without throwing', () => {
    // Empty/undefined branch coverage for severity / resource_type / resource / type / rule_id.
    const fp = buildOrchestratorFingerprint({})
    expect(fp).toMatch(/^[0-9a-f]{32}$/)
    // Stable under repeated invocation.
    expect(buildOrchestratorFingerprint({})).toBe(fp)
  })

  it('treats explicit empty strings the same as undefined fields', () => {
    const allEmpty = buildOrchestratorFingerprint({ connection_id: '', type: '', severity: '', resource_type: '', resource: '', rule_id: '' })
    const allUndefined = buildOrchestratorFingerprint({})
    expect(allEmpty).toBe(allUndefined)
  })
})
