import { describe, it, expect } from 'vitest'

import { buildTenantFacets, selectableTenants } from './tenantFacets'

const TENANTS = [
  { id: 'tenant-b', name: 'Bravo' },
  { id: 'default', name: 'Provider' },
  { id: 'tenant-a', name: 'Alpha' },
  { id: 'tenant-vdc', name: 'Vdc only' },
]

const CONNECTIONS = [
  { tenantId: 'tenant-a' },
  { tenantId: 'tenant-a' },
  { tenantId: 'tenant-b' },
]

const ROWS = [
  { tenantId: 'tenant-a' },
  { tenantId: 'tenant-a' },
  { tenantId: 'tenant-a' },
  { tenantId: 'tenant-b' },
]

describe('buildTenantFacets', () => {
  it('sorts the provider tenant first, then alphabetically by name', () => {
    const facets = buildTenantFacets(TENANTS, CONNECTIONS, ROWS)

    expect(facets.map(f => f.id)).toEqual(['default', 'tenant-a', 'tenant-b', 'tenant-vdc'])
  })

  it('counts connections and storages per tenant', () => {
    const facets = buildTenantFacets(TENANTS, CONNECTIONS, ROWS)
    const alpha = facets.find(f => f.id === 'tenant-a')

    expect(alpha).toEqual({ id: 'tenant-a', name: 'Alpha', connectionCount: 2, storageCount: 3 })
  })

  it('keeps a tenant that owns no connection, at zero', () => {
    const facets = buildTenantFacets(TENANTS, CONNECTIONS, ROWS)
    const vdcOnly = facets.find(f => f.id === 'tenant-vdc')

    expect(vdcOnly).toEqual({ id: 'tenant-vdc', name: 'Vdc only', connectionCount: 0, storageCount: 0 })
  })

  it('ignores rows carrying no tenant', () => {
    const facets = buildTenantFacets(TENANTS, CONNECTIONS, [{ tenantId: undefined }, { tenantId: null }])

    expect(facets.every(f => f.storageCount === 0)).toBe(true)
  })

  it('returns an empty list when no tenant is given', () => {
    expect(buildTenantFacets([], CONNECTIONS, ROWS)).toEqual([])
  })
})

describe('selectableTenants', () => {
  it('drops a tenant whose only reach is a vDC', () => {
    const kept = selectableTenants(TENANTS, ['tenant-vdc'], CONNECTIONS)

    expect(kept.map(t => t.id)).toEqual(['tenant-b', 'default', 'tenant-a'])
  })

  it('keeps a tenant that holds a vDC but also owns a connection', () => {
    const kept = selectableTenants(TENANTS, ['tenant-a'], CONNECTIONS)

    expect(kept.map(t => t.id)).toContain('tenant-a')
  })

  it('keeps a tenant that owns nothing and holds no vDC, so it shows a legitimate zero', () => {
    const kept = selectableTenants(TENANTS, [], CONNECTIONS)

    expect(kept.map(t => t.id)).toContain('tenant-vdc')
  })

  it('preserves the input order and returns every tenant when no vDC exists', () => {
    expect(selectableTenants(TENANTS, [], CONNECTIONS)).toEqual(TENANTS)
  })

  it('ignores a vDC tenant id that matches no tenant', () => {
    expect(selectableTenants(TENANTS, ['ghost'], CONNECTIONS)).toEqual(TENANTS)
  })

  it('returns an empty list when no tenant is given', () => {
    expect(selectableTenants([], ['tenant-vdc'], CONNECTIONS)).toEqual([])
  })
})
