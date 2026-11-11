import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  tenant: { findMany: vi.fn() },
  userTenant: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), delete: vi.fn(), update: vi.fn() },
  rbacUserRole: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), groupBy: vi.fn() },
  rbacUserPermission: { findFirst: vi.fn() },
  rbacServiceDeskAssignment: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  rbacRolePermission: { findMany: vi.fn() },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: db }))

import {
  assignmentsRevokedByPublication,
  computeServiceDeskTargets,
  isServiceDeskAccount,
  isServiceDeskManaged,
  isServiceDeskRowId,
  listCustomerTenantIds,
  loadTenantCeiling,
  parseServiceDeskTarget,
  serviceDeskRowId,
  syncServiceDeskAssignment,
  syncServiceDeskForNewTenant,
  syncServiceDeskForRole,
} from './serviceDesk'

const NOW = new Date('2026-11-10T12:00:00Z')
const role = (over: Record<string, unknown> = {}) => ({ audience: 'service_desk', publishAll: false, publications: [] as { tenantId: string }[], ...over })
const assignment = (over: Record<string, unknown> = {}) => ({
  id: 'sda_1',
  userId: 'u1',
  roleId: 'r1',
  allTenants: true,
  tenantIds: [] as string[],
  grantedById: 'admin',
  grantedAt: NOW,
  expiresAt: null as Date | null,
  role: role({ publishAll: true }),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  db.tenant.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }])
  db.rbacUserRole.findMany.mockResolvedValue([])
  db.userTenant.findUnique.mockResolvedValue(null)
  db.userTenant.findFirst.mockResolvedValue(null)
  db.rbacUserRole.findFirst.mockResolvedValue(null)
  db.rbacUserPermission.findFirst.mockResolvedValue(null)
  db.$transaction.mockImplementation(async (fn: any) => fn(db))
})

describe('computeServiceDeskTargets', () => {
  const base = { customerTenantIds: ['default', 't1', 't2', 't3'], now: NOW }

  it('follows the publication, the provider tenant excluded', () => {
    expect(computeServiceDeskTargets({ ...base, assignment: { allTenants: true, tenantIds: [], expiresAt: null }, role: role({ publishAll: true }) })).toEqual(['t1', 't2', 't3'])
    expect(computeServiceDeskTargets({ ...base, assignment: { allTenants: true, tenantIds: [], expiresAt: null }, role: role({ publications: [{ tenantId: 't2' }, { tenantId: 'gone' }] }) })).toEqual(['t2'])
  })

  it('narrows the publication with the assignment list, never widens it', () => {
    expect(computeServiceDeskTargets({ ...base, assignment: { allTenants: false, tenantIds: ['t1', 't3'], expiresAt: null }, role: role({ publications: [{ tenantId: 't1' }, { tenantId: 't2' }] }) })).toEqual(['t1'])
  })

  it('reaches nothing once expired, or when the role left the service desk audience', () => {
    expect(computeServiceDeskTargets({ ...base, assignment: { allTenants: true, tenantIds: [], expiresAt: NOW }, role: role({ publishAll: true }) })).toEqual([])
    expect(computeServiceDeskTargets({ ...base, assignment: { allTenants: true, tenantIds: [], expiresAt: null }, role: role({ audience: 'tenant', publishAll: true }) })).toEqual([])
  })
})

describe('row ids', () => {
  it('builds and recognises the service desk rows', () => {
    expect(serviceDeskRowId('sda_1', 't1')).toBe('sd_sda_1_t1')
    expect(isServiceDeskRowId('sd_sda_1_t1')).toBe(true)
    expect(isServiceDeskRowId('assign_x')).toBe(false)
    expect(isServiceDeskRowId(null)).toBe(false)
  })

  it('reads a provider service desk row as managed: its own rows for all, a service desk role for a customer tenant', () => {
    const sso = { id: 'oidc_1', role: { audience: 'service_desk' } }
    expect(isServiceDeskManaged({ id: 'sd_sda_1_t1' }, 'default')).toBe(true)
    expect(isServiceDeskManaged(sso, 't1')).toBe(true)
    expect(isServiceDeskManaged(sso, 'default')).toBe(false)
    expect(isServiceDeskManaged({ id: 'assign_1', role: { audience: 'tenant' } }, 't1')).toBe(false)
    expect(isServiceDeskManaged({ id: 'assign_2', role: null }, 't1')).toBe(false)
  })
})

describe('syncServiceDeskAssignment', () => {
  it('creates the membership and the row of every target tenant; the first membership becomes the landing tenant', async () => {
    db.rbacServiceDeskAssignment.findUnique.mockResolvedValue(assignment())
    db.userTenant.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ userId: 'u1' })

    const result = await syncServiceDeskAssignment('sda_1', { now: NOW })

    expect(result).toEqual({ added: ['t1', 't2'], removed: [] })
    expect(db.userTenant.create.mock.calls.map(c => c[0].data)).toEqual([
      { userId: 'u1', tenantId: 't1', isDefault: true, joinedAt: NOW },
      { userId: 'u1', tenantId: 't2', isDefault: false, joinedAt: NOW },
    ])
    expect(db.rbacUserRole.create.mock.calls.map(c => c[0].data.id)).toEqual(['sd_sda_1_t1', 'sd_sda_1_t2'])
    expect(db.rbacUserRole.create.mock.calls[0][0].data).toMatchObject({ scopeType: 'inherit', roleId: 'r1', tenantId: 't1', grantedById: 'admin' })
  })

  it('keeps an existing membership and refreshes an existing row', async () => {
    db.rbacServiceDeskAssignment.findUnique.mockResolvedValue(assignment({ expiresAt: new Date('2027-01-01') }))
    db.rbacUserRole.findMany.mockResolvedValue([{ id: 'sd_sda_1_t1', tenantId: 't1', userId: 'u1' }])
    db.userTenant.findUnique.mockResolvedValue({ userId: 'u1' })

    const result = await syncServiceDeskAssignment('sda_1', { now: NOW, customerTenantIds: ['t1'] })

    expect(result).toEqual({ added: [], removed: [] })
    expect(db.userTenant.create).not.toHaveBeenCalled()
    expect(db.rbacUserRole.update).toHaveBeenCalledWith({ where: { id: 'sd_sda_1_t1' }, data: { roleId: 'r1', expiresAt: new Date('2027-01-01') } })
  })

  it('removes every row of a deleted assignment and releases the membership it stood on, moving the landing tenant', async () => {
    db.rbacServiceDeskAssignment.findUnique.mockResolvedValue(null)
    db.rbacUserRole.findMany.mockResolvedValue([{ id: 'sd_sda_1_t1', tenantId: 't1', userId: 'u1' }])
    db.userTenant.findUnique.mockResolvedValue({ isDefault: true })
    db.userTenant.findFirst.mockResolvedValue({ tenantId: 't2' })

    const result = await syncServiceDeskAssignment('sda_1', { now: NOW })

    expect(result).toEqual({ added: [], removed: ['t1'] })
    expect(db.rbacUserRole.delete).toHaveBeenCalledWith({ where: { id: 'sd_sda_1_t1' } })
    expect(db.userTenant.delete).toHaveBeenCalledWith({ where: { userId_tenantId: { userId: 'u1', tenantId: 't1' } } })
    expect(db.userTenant.update).toHaveBeenCalledWith({ where: { userId_tenantId: { userId: 'u1', tenantId: 't2' } }, data: { isDefault: true } })
  })

  it('keeps the membership while another grant stands there, and the last membership of the user', async () => {
    db.rbacServiceDeskAssignment.findUnique.mockResolvedValue(null)
    db.rbacUserRole.findMany.mockResolvedValue([
      { id: 'sd_sda_1_t1', tenantId: 't1', userId: 'u1' },
      { id: 'sd_sda_1_t2', tenantId: 't2', userId: 'u1' },
    ])
    // t1: another role stands. t2: no grant left, but it is the last membership.
    db.rbacUserRole.findFirst.mockImplementation(async ({ where }: any) => (where.tenantId === 't1' ? { id: 'assign_x' } : null))
    db.userTenant.findUnique.mockResolvedValue({ isDefault: false })
    db.userTenant.findFirst.mockResolvedValue(null)

    await syncServiceDeskAssignment('sda_1', { now: NOW })

    expect(db.userTenant.delete).not.toHaveBeenCalled()
  })

  it('never drops the membership of a super admin, nor one that is already gone', async () => {
    db.rbacServiceDeskAssignment.findUnique.mockResolvedValue(null)
    db.rbacUserRole.findMany.mockResolvedValue([{ id: 'sd_sda_1_t1', tenantId: 't1', userId: 'u1' }])
    db.rbacUserRole.findFirst.mockImplementation(async ({ where }: any) => (where.roleId === 'role_super_admin' ? { id: 'sa' } : null))
    await syncServiceDeskAssignment('sda_1', { now: NOW })
    expect(db.userTenant.delete).not.toHaveBeenCalled()

    db.rbacUserRole.findFirst.mockResolvedValue(null)
    db.userTenant.findUnique.mockResolvedValue(null)
    await syncServiceDeskAssignment('sda_1', { now: NOW })
    expect(db.userTenant.delete).not.toHaveBeenCalled()
  })
})

describe('bulk syncs', () => {
  it('re-syncs every assignment of a role and sums the changes', async () => {
    db.rbacServiceDeskAssignment.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    db.rbacServiceDeskAssignment.findUnique.mockImplementation(async ({ where }: any) => assignment({ id: where.id, userId: `u_${where.id}` }))
    db.userTenant.findFirst.mockResolvedValue({ userId: 'x' })

    const result = await syncServiceDeskForRole('r1')

    expect(result.added).toHaveLength(4)
    expect(db.rbacServiceDeskAssignment.findMany).toHaveBeenCalledWith({ where: { roleId: 'r1' }, select: { id: true } })
  })

  it('reaches a new tenant with the assignments that follow a role published to all tenants', async () => {
    db.rbacServiceDeskAssignment.findMany.mockResolvedValue([{ id: 'a' }])
    db.rbacServiceDeskAssignment.findUnique.mockResolvedValue(assignment({ id: 'a' }))
    db.userTenant.findFirst.mockResolvedValue({ userId: 'x' })

    await syncServiceDeskForNewTenant()

    expect(db.rbacServiceDeskAssignment.findMany.mock.calls[0][0].where).toEqual({ allTenants: true, role: { audience: 'service_desk', publishAll: true } })
    expect(db.rbacUserRole.create).toHaveBeenCalledTimes(2)
  })
})

describe('parseServiceDeskTarget', () => {
  const published = { publishAll: false, publications: [{ tenantId: 't1' }, { tenantId: 't2' }] }

  it('follows the publication unless told otherwise', () => {
    expect(parseServiceDeskTarget({}, published, ['t1', 't2'])).toEqual({ ok: true, allTenants: true, tenantIds: [] })
  })

  it('needs a non-empty list of published tenants', () => {
    expect(parseServiceDeskTarget({ all_tenants: false, tenant_ids: 't1' }, published, ['t1']).ok).toBe(false)
    expect(parseServiceDeskTarget({ all_tenants: false, tenant_ids: [] }, published, ['t1'])).toMatchObject({ ok: false, error: 'Select at least one tenant' })
    expect(parseServiceDeskTarget({ all_tenants: false, tenant_ids: ['t3'] }, published, ['t1', 't2', 't3'])).toMatchObject({ ok: false, error: 'The role is not published to: t3' })
  })

  it('accepts a narrower list, sorted and deduped, with a role published to all', () => {
    expect(parseServiceDeskTarget({ all_tenants: false, tenant_ids: ['t2', 't1', 't2'] }, published, ['t1', 't2'])).toEqual({ ok: true, allTenants: false, tenantIds: ['t1', 't2'] })
    expect(parseServiceDeskTarget({ all_tenants: false, tenant_ids: ['t9'] }, { publishAll: true, publications: [] }, ['t9'])).toEqual({ ok: true, allTenants: false, tenantIds: ['t9'] })
  })
})

describe('lookups', () => {
  it('reads the ceiling from the Tenant Admin role', async () => {
    db.rbacRolePermission.findMany.mockResolvedValue([{ permission: { name: 'vm.view' } }])
    const ceiling = await loadTenantCeiling()
    expect([...ceiling].sort((a, b) => a.localeCompare(b))).toEqual(['vm.config.nic.mac', 'vm.config.nic.vlan', 'vm.view'])
  })

  it('lists the customer tenants', async () => {
    expect(await listCustomerTenantIds()).toEqual(['t1', 't2'])
  })

  it('tells a service desk account apart, by assignment or by an SSO row on a service desk role', async () => {
    db.rbacServiceDeskAssignment.findFirst.mockResolvedValueOnce({ id: 'a' }).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    db.rbacUserRole.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'oidc_1' }).mockResolvedValueOnce(null)
    expect(await isServiceDeskAccount('u1')).toBe(true)
    expect(await isServiceDeskAccount('u2')).toBe(true)
    expect(await isServiceDeskAccount('u3')).toBe(false)
    expect(db.rbacUserRole.findFirst).toHaveBeenCalledWith({ where: { userId: 'u2', role: { audience: 'service_desk' } }, select: { id: true } })
  })

  it('lists the assignments a narrower publication would revoke, by tenant name', async () => {
    expect(await assignmentsRevokedByPublication('r1', 'all')).toEqual([])
    db.rbacUserRole.groupBy.mockResolvedValue([
      { tenantId: 't2', _count: { _all: 3 } },
      { tenantId: 't1', _count: { _all: 1 } },
      { tenantId: 't3', _count: { _all: 2 } },
    ])
    db.tenant.findMany.mockResolvedValue([{ id: 't2', name: 'Beta' }, { id: 't3', name: 'Alpha' }])
    expect(await assignmentsRevokedByPublication('r1', new Set(['t1']))).toEqual([
      { tenantId: 't3', tenantName: 'Alpha', count: 2 },
      { tenantId: 't2', tenantName: 'Beta', count: 3 },
    ])
    db.rbacUserRole.groupBy.mockResolvedValue([{ tenantId: 't1', _count: { _all: 1 } }])
    expect(await assignmentsRevokedByPublication('r1', new Set(['t1']))).toEqual([])
  })
})
