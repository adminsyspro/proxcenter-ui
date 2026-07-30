import { describe, it, expect } from 'vitest'

import { buildTenantFacets } from './tenantFacets'

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
