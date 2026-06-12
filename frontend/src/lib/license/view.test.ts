import { describe, it, expect } from 'vitest'
import { buildLicenseTableRows, computePerTenantRollup } from './view'

const status = {
  license_id: 'PRIMARY-1',
  expires_at: '2027-03-23T00:00:00Z',
  customer: { name: 'Acme Corp' },
  node_status: {
    current_nodes: 18,
    max_nodes: 23,
    per_license: [
      { license_id: 'PRIMARY-1', max_nodes: 10, used_nodes: 10, is_primary: true, connections: ['c-pool'] },
      { license_id: 'LIC-A', max_nodes: 8, used_nodes: 8, connections: ['c-a'] },
      { license_id: 'LIC-B', max_nodes: 12, used_nodes: 5, connections: ['c-b'] },
    ],
  },
}
const imports = [
  { id: 'imp-a', license_id: 'LIC-A', edition: 'enterprise', max_nodes: 8, cluster_uuid: 'cluster-a', expires_at: '2027-03-23T00:00:00Z', state: 'active', connection_ids: ['c-a'], customer: 'Client A' },
  { id: 'imp-b', license_id: 'LIC-B', edition: 'enterprise', max_nodes: 12, cluster_uuid: null, expires_at: '2027-06-30T00:00:00Z', state: 'active', connection_ids: ['c-b'], customer: 'Client B' },
]

describe('buildLicenseTableRows', () => {
  it('emits a primary row + one row per import, joining used/max from per_license', () => {
    const rows = buildLicenseTableRows(status as any, imports as any)
    expect(rows).toHaveLength(3)
    const primary = rows.find(r => r.role === 'primary')!
    expect(primary.rowId).toBe('primary')
    expect(primary.licenseId).toBe('PRIMARY-1')
    expect(primary.usedNodes).toBe(10)
    expect(primary.maxNodes).toBe(10)
    expect(primary.expiresAt).toBe('2027-03-23T00:00:00Z')
    expect(primary.licensedTo).toBe('Acme Corp')

    const a = rows.find(r => r.licenseId === 'LIC-A')!
    expect(a.role).toBe('import')
    expect(a.rowId).toBe('imp-a')
    expect(a.usedNodes).toBe(8)
    expect(a.maxNodes).toBe(8)
    expect(a.clusterUuid).toBe('cluster-a')
    expect(a.expiresAt).toBe('2027-03-23T00:00:00Z')
    expect(a.connectionIds).toEqual(['c-a'])
    expect(a.licensedTo).toBe('Client A')
  })

  it('prefers customer.company over name for the primary licensed-to', () => {
    const s = {
      license_id: 'P',
      customer: { name: 'Jean Dupont', company: 'Acme Corp' },
      node_status: { per_license: [{ license_id: 'P', max_nodes: 5, used_nodes: 1, is_primary: true }] },
    }
    const rows = buildLicenseTableRows(s as any, [])
    expect(rows[0].licensedTo).toBe('Acme Corp')
  })

  it('returns empty when there is no node_status (feature off)', () => {
    expect(buildLicenseTableRows({} as any, [])).toEqual([])
  })

  it('lists an import that has no per_license entry (e.g. inert/expired) with 0 used', () => {
    const rows = buildLicenseTableRows(
      { node_status: { per_license: [{ license_id: 'PRIMARY-1', max_nodes: 10, used_nodes: 0, is_primary: true }] }, license_id: 'PRIMARY-1' } as any,
      [{ id: 'imp-x', license_id: 'LIC-X', edition: 'enterprise', max_nodes: 5, cluster_uuid: null, expires_at: '2020-01-01T00:00:00Z', state: 'active', connection_ids: [] }] as any,
    )
    const x = rows.find(r => r.licenseId === 'LIC-X')!
    expect(x.usedNodes).toBe(0)
    expect(x.maxNodes).toBe(5)
  })
})

describe('computePerTenantRollup', () => {
  it('groups non-primary licenses under their connections owning tenant', () => {
    const connToTenant = { 'c-a': 'tenant-a', 'c-b': 'tenant-b', 'c-pool': 'default' }
    const rows = computePerTenantRollup(status.node_status.per_license as any, connToTenant, { 'tenant-a': 'Client A', 'tenant-b': 'Client B' })
    expect(rows).toHaveLength(2)
    const a = rows.find(r => r.tenantId === 'tenant-a')!
    expect(a.tenantName).toBe('Client A')
    expect(a.usedNodes).toBe(8)
    expect(a.maxNodes).toBe(8)
    expect(a.licenseIds).toEqual(['LIC-A'])
    const b = rows.find(r => r.tenantId === 'tenant-b')!
    expect(b.usedNodes).toBe(5)
    expect(b.maxNodes).toBe(12)
  })

  it('marks unlimited and skips the primary', () => {
    const perLicense = [
      { license_id: 'P', is_primary: true, max_nodes: 0, used_nodes: 3, connections: ['c-pool'] },
      { license_id: 'U', max_nodes: 0, unlimited: true, used_nodes: 99, connections: ['c-a'] },
    ]
    const rows = computePerTenantRollup(perLicense as any, { 'c-a': 'tenant-a', 'c-pool': 'default' }, {})
    expect(rows).toHaveLength(1)
    expect(rows[0].unlimited).toBe(true)
    expect(rows[0].usedNodes).toBe(99)
  })
})
