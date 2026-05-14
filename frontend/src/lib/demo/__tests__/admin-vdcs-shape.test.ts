import { describe, it, expect } from 'vitest'

import mockData from '../mock-data.json'

describe('demo mock: admin/vdcs response shape', () => {
  it('list endpoint exposes the expected top-level keys', () => {
    const payload = (mockData as Record<string, any>)['/api/v1/admin/vdcs']

    expect(payload).toBeDefined()
    expect(Array.isArray(payload.data)).toBe(true)
    expect(payload.data.length).toBe(4)
    const sample = payload.data[0]

    const expectedKeys = [
      'id', 'tenantId', 'tenantName', 'connectionId',
      'name', 'slug', 'description', 'pvePoolName', 'sdnZoneName',
      'primaryStorage', 'enabled', 'createdBy', 'createdAt', 'updatedAt',
      'nodes', 'storages', 'quota', 'usage', 'sharedBridges', 'vnets', 'pbsBindings',
    ]

    for (const k of expectedKeys) {
      expect(sample, `missing field ${k}`).toHaveProperty(k)
    }
  })

  it('every vDC has a non-null quota and usage', () => {
    const payload = (mockData as Record<string, any>)['/api/v1/admin/vdcs']

    for (const v of payload.data) {
      expect(v.quota, `${v.id} quota`).not.toBeNull()
      expect(v.usage, `${v.id} usage`).not.toBeNull()
      expect(typeof v.usage.lastSyncedAt).toBe('string')
    }
  })

  it('no vDC has a connectionName field (excluded per types.ts/buildVdcWithDetails)', () => {
    const payload = (mockData as Record<string, any>)['/api/v1/admin/vdcs']

    for (const v of payload.data) {
      expect(v, `${v.id} should not have connectionName`).not.toHaveProperty('connectionName')
    }
  })
})
