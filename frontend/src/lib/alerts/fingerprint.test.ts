import { describe, it, expect } from 'vitest'

import { generateFingerprint } from './fingerprint'

describe('generateFingerprint', () => {
  it('returns a 32-char hex string (MD5)', () => {
    const fp = generateFingerprint({ source: 'test' })

    expect(fp).toMatch(/^[0-9a-f]{32}$/)
  })

  it('is deterministic (same input → same output)', () => {
    const alert = { source: 'proxmox', severity: 'critical', entityType: 'vm', entityId: '100', metric: 'cpu' }
    const fp1 = generateFingerprint(alert)
    const fp2 = generateFingerprint(alert)

    expect(fp1).toBe(fp2)
  })

  it('produces different fingerprints for different sources', () => {
    const fp1 = generateFingerprint({ source: 'proxmox' })
    const fp2 = generateFingerprint({ source: 'pbs' })

    expect(fp1).not.toBe(fp2)
  })

  it('produces different fingerprints for different severities', () => {
    const fp1 = generateFingerprint({ source: 'test', severity: 'warning' })
    const fp2 = generateFingerprint({ source: 'test', severity: 'critical' })

    expect(fp1).not.toBe(fp2)
  })

  it('produces different fingerprints for different entityIds', () => {
    const fp1 = generateFingerprint({ source: 'test', entityId: '100' })
    const fp2 = generateFingerprint({ source: 'test', entityId: '200' })

    expect(fp1).not.toBe(fp2)
  })

  it('handles all optional fields missing', () => {
    const fp = generateFingerprint({ source: 'test' })

    expect(fp).toMatch(/^[0-9a-f]{32}$/)
  })

  it('treats missing optional fields as empty strings', () => {
    const fp1 = generateFingerprint({ source: 'test' })
    const fp2 = generateFingerprint({ source: 'test', severity: '', entityType: '', entityId: '', metric: '' })

    expect(fp1).toBe(fp2)
  })

  it('different metrics produce different fingerprints', () => {
    const base = { source: 'proxmox', severity: 'warning', entityType: 'vm', entityId: '100' }
    const fp1 = generateFingerprint({ ...base, metric: 'cpu' })
    const fp2 = generateFingerprint({ ...base, metric: 'memory' })

    expect(fp1).not.toBe(fp2)
  })
})
