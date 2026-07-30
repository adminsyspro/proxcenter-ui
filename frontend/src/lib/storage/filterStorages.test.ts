import { describe, it, expect } from 'vitest'

import { filterStorages } from './filterStorages'

const ROWS = [
  {
    id: 'conn-1:local-lvm',
    storage: 'local-lvm',
    type: 'lvmthin',
    shared: false,
    connId: 'conn-1',
    connName: 'PVE-1',
    connectionName: 'PVE-1',
    connections: [{ id: 'conn-1', name: 'PVE-1' }],
    node: 'pve1-n1',
    tenantId: 'tenant-a',
    tenantName: 'Alpha',
  },
  {
    id: 'conn-2:nfs-shared',
    storage: 'nfs-shared',
    type: 'nfs',
    shared: true,
    connId: 'conn-2',
    connName: 'PVE-2',
    connectionName: 'PVE-2',
    connections: [{ id: 'conn-2', name: 'PVE-2' }],
    node: 'pve2-n1',
    tenantId: 'tenant-b',
    tenantName: 'Bravo',
  },
]

const ALL = { connId: '*', query: '', type: 'all', scope: 'all' as const, tenantIds: null }

describe('filterStorages', () => {
  it('returns every row with the neutral criteria', () => {
    expect(filterStorages(ROWS, ALL)).toHaveLength(2)
  })

  it('keeps only the selected tenants', () => {
    const out = filterStorages(ROWS, { ...ALL, tenantIds: ['tenant-b'] })

    expect(out.map(r => r.id)).toEqual(['conn-2:nfs-shared'])
  })

  it('returns nothing when the tenant selection is empty', () => {
    expect(filterStorages(ROWS, { ...ALL, tenantIds: [] })).toEqual([])
  })

  it('ignores the tenant filter entirely when tenantIds is null', () => {
    const rowsWithoutTenant = ROWS.map(r => ({ ...r, tenantId: undefined, tenantName: undefined }))

    expect(filterStorages(rowsWithoutTenant, ALL)).toHaveLength(2)
  })

  it('drops a row carrying no tenant once a selection is active', () => {
    const rows = [{ ...ROWS[0], tenantId: undefined }]

    expect(filterStorages(rows, { ...ALL, tenantIds: ['tenant-a'] })).toEqual([])
  })

  it('matches the tenant name in the free-text search', () => {
    const out = filterStorages(ROWS, { ...ALL, query: 'brav' })

    expect(out.map(r => r.id)).toEqual(['conn-2:nfs-shared'])
  })

  it('still filters by connection, type and scope', () => {
    expect(filterStorages(ROWS, { ...ALL, connId: 'conn-1' }).map(r => r.id)).toEqual(['conn-1:local-lvm'])
    expect(filterStorages(ROWS, { ...ALL, type: 'nfs' }).map(r => r.id)).toEqual(['conn-2:nfs-shared'])
    expect(filterStorages(ROWS, { ...ALL, scope: 'shared' }).map(r => r.id)).toEqual(['conn-2:nfs-shared'])
    expect(filterStorages(ROWS, { ...ALL, scope: 'local' }).map(r => r.id)).toEqual(['conn-1:local-lvm'])
  })

  it('composes the tenant filter with the other predicates', () => {
    const out = filterStorages(ROWS, { ...ALL, tenantIds: ['tenant-a', 'tenant-b'], scope: 'shared', type: 'nfs' })

    expect(out.map(r => r.id)).toEqual(['conn-2:nfs-shared'])
  })

  it('trims and lowercases the query', () => {
    expect(filterStorages(ROWS, { ...ALL, query: '  LOCAL-LVM  ' }).map(r => r.id)).toEqual(['conn-1:local-lvm'])
  })
})
