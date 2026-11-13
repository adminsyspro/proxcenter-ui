import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auditMock, tenantFindManyMock, ceilingMock, userRoleFindManyMock } = vi.hoisted(() => ({
  auditMock: vi.fn(),
  tenantFindManyMock: vi.fn(),
  ceilingMock: vi.fn(),
  userRoleFindManyMock: vi.fn(),
}))

vi.mock('@/lib/audit', () => ({ audit: auditMock }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: { tenant: { findMany: tenantFindManyMock }, rbacUserRole: { findMany: userRoleFindManyMock } },
}))
vi.mock('./serviceDesk', async importOriginal => ({
  ...(await importOriginal<typeof import('./serviceDesk')>()),
  loadTenantCeiling: ceilingMock,
}))

import { findUnknownTenant, refuseOverCeiling } from './catalogueGuards'
import { parseExpiry, reachedTenants, toWire } from './serviceDeskApi'

beforeEach(() => {
  vi.clearAllMocks()
  ceilingMock.mockResolvedValue(new Set(['vm.view', 'admin.users']))
})

describe('refuseOverCeiling', () => {
  const user = { id: 'admin', email: 'a@x' }

  it('lets a role that is not published through without reading the ceiling', async () => {
    expect(await refuseOverCeiling(null, ['admin.tenants'], user, 'R')).toBeNull()
    expect(await refuseOverCeiling('provider', ['admin.tenants'], user, 'R')).toBeNull()
    expect(ceilingMock).not.toHaveBeenCalled()
  })

  it('passes a published role within the ceiling', async () => {
    expect(await refuseOverCeiling('tenant', ['vm.view'], user, 'R')).toBeNull()
  })

  it('refuses and audits a published role over the ceiling, naming the permissions', async () => {
    const res = await refuseOverCeiling('service_desk', ['vm.view', 'connection.manage', 'admin.tenants'], user, 'SD L1')
    expect(res?.status).toBe(400)
    expect(await res?.json()).toEqual({
      error: 'These permissions cannot be given to a role published to tenants: admin.tenants, connection.manage',
      code: 'PERMISSION_CEILING',
      permissions: ['admin.tenants', 'connection.manage'],
    })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'rbac_role_ceiling_refused',
      status: 'failure',
      resourceName: 'SD L1',
      details: { audience: 'service_desk', permissions: ['admin.tenants', 'connection.manage'] },
    }))
  })
})

describe('findUnknownTenant', () => {
  it('needs no lookup for an empty list', async () => {
    expect(await findUnknownTenant([])).toBeNull()
    expect(tenantFindManyMock).not.toHaveBeenCalled()
  })

  it('names the first id that is not a customer tenant', async () => {
    tenantFindManyMock.mockResolvedValue([{ id: 't1' }])
    expect(await findUnknownTenant(['t1', 'ghost'])).toBe('ghost')
    expect(tenantFindManyMock.mock.calls[0][0].where).toEqual({ id: { in: ['t1', 'ghost'], not: 'default' } })
    expect(await findUnknownTenant(['t1'])).toBeNull()
  })
})

describe('service desk wire helpers', () => {
  const row = {
    id: 'sda_1',
    allTenants: false,
    tenantIds: ['t1'],
    grantedAt: new Date('2026-11-10T00:00:00Z'),
    expiresAt: null,
    user: { id: 'u1', email: 'sd@x', name: null },
    role: { id: 'r1', name: 'SD', color: '#000' },
    grantedBy: { email: 'admin@x' },
  }

  it('maps an assignment with the tenants it reaches', () => {
    expect(toWire(row, [{ id: 't1', name: 'One' }])).toEqual({
      id: 'sda_1',
      user: row.user,
      role: row.role,
      all_tenants: false,
      tenant_ids: ['t1'],
      tenants: [{ id: 't1', name: 'One' }],
      granted_at: '2026-11-10T00:00:00.000Z',
      granted_by_email: 'admin@x',
      expires_at: null,
    })
    expect(toWire({ ...row, grantedBy: null, tenantIds: null as unknown as string[], expiresAt: new Date('2027-01-01T00:00:00Z') }, []))
      .toMatchObject({ granted_by_email: null, tenant_ids: [], expires_at: '2027-01-01T00:00:00.000Z' })
  })

  it('resolves the tenants each assignment reaches from its rows', async () => {
    expect((await reachedTenants([])).size).toBe(0)
    userRoleFindManyMock.mockResolvedValue([
      { id: 'sd_a_t2', tenantId: 't2' },
      { id: 'sd_a_t1', tenantId: 't1' },
      { id: 'sd_b_t1', tenantId: 't1' },
    ])
    tenantFindManyMock.mockResolvedValue([{ id: 't1', name: 'Zulu' }, { id: 't2', name: 'Alpha' }])
    const out = await reachedTenants(['a', 'b'])
    expect(out.get('a')).toEqual([{ id: 't2', name: 'Alpha' }, { id: 't1', name: 'Zulu' }])
    expect(out.get('b')).toEqual([{ id: 't1', name: 'Zulu' }])
  })

  it('parses an optional expiry', () => {
    expect(parseExpiry(undefined)).toEqual({ ok: true, value: null })
    expect(parseExpiry('')).toEqual({ ok: true, value: null })
    expect(parseExpiry('2027-01-01T00:00:00Z')).toEqual({ ok: true, value: new Date('2027-01-01T00:00:00Z') })
    expect(parseExpiry('soon')).toEqual({ ok: false })
  })
})
