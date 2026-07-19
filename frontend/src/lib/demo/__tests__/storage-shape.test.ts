import { describe, it, expect } from 'vitest'

import { EXTRA_MOCKS } from '../demo-api'

describe('demo GET:/api/v1/storage', () => {
  it('returns a flat data array the Overview page can read', () => {
    const res = (EXTRA_MOCKS as any)['GET:/api/v1/storage']
    expect(Array.isArray(res.data)).toBe(true)
    expect(res.data.length).toBeGreaterThan(0)
    expect(res.connections.length).toBeGreaterThan(0)
  })

  it('keeps the DR-cluster storage separate from the production cluster (#569)', () => {
    const res = (EXTRA_MOCKS as any)['GET:/api/v1/storage']
    const cephEntries = res.data.filter((s: any) => s.storage === 'CephStoragePool')
    // Same storage name on two different clusters must stay two distinct rows.
    expect(cephEntries.length).toBe(2)
    const connIds = new Set(cephEntries.map((s: any) => s.connId))
    expect(connIds.has('demo-pve-cluster-001')).toBe(true)
    expect(connIds.has('demo-pve-dr-001')).toBe(true)
  })

  it('exposes a per-node breakdown for the DR local storage', () => {
    const res = (EXTRA_MOCKS as any)['GET:/api/v1/storage']
    const drLocal = res.data.find((s: any) => s.connId === 'demo-pve-dr-001' && s.storage === 'local')
    expect(drLocal).toBeDefined()
    expect(drLocal.nodeBreakdown.length).toBe(2)
  })
})
