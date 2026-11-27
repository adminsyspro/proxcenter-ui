/**
 * roadmap#278: the alert rule and report write routes need a WRITE right.
 * Real routes, real RBAC and the real system role catalogue over the test
 * database; only the session and the orchestrator are stubbed. A read-only
 * role (Viewer, Tenant Viewer, Tenant Operator) gets 403 on every write and
 * the orchestrator is never called; the roles that own the right get past
 * the guard.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { headersMock, sessionMock, orchestratorFetchMock } = vi.hoisted(() => ({
  headersMock: vi.fn<() => Promise<Headers>>(),
  sessionMock: vi.fn<() => Promise<any>>(),
  orchestratorFetchMock: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: headersMock }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/orchestrator/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/orchestrator/client')>()),
  orchestratorFetch: (...a: unknown[]) => orchestratorFetchMock(...a),
}))

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { seedDefaultTenant } from '@/__tests__/setup/apiTokens'
import { ALL_PERMISSIONS, ROLES } from '../../../../../../prisma/roleCatalogue'

import * as rules from '../alerts/rules/route'
import * as rule from '../alerts/rules/[id]/route'
import * as toggle from '../alerts/rules/[id]/toggle/route'
import * as reports from '../reports/route'
import * as report from '../reports/[id]/route'
import * as schedules from '../reports/schedules/route'
import * as schedule from '../reports/schedules/[id]/route'
import * as run from '../reports/schedules/[id]/run/route'

const now = new Date()
const TENANT = 'acme'

async function seedCatalogue() {
  // The test schema is shared: drop rows another file left under a catalogue
  // name but another id, they would break the upsert on the unique name.
  const ids = ALL_PERMISSIONS.map(p => p.id)
  await prismaTest.rbacPermission.deleteMany({ where: { name: { in: ids }, id: { notIn: ids } } })
  for (const p of ALL_PERMISSIONS) {
    await prismaTest.rbacPermission.upsert({
      where: { id: p.id },
      update: {},
      create: { id: p.id, name: p.name, category: p.category, description: p.description, isDangerous: p.isDangerous ?? false },
    })
  }
  const all = ALL_PERMISSIONS.map(p => p.id)
  for (const r of ROLES) {
    const ids = r.permissions.includes('*') ? all : r.permissions.filter(p => all.includes(p))
    await prismaTest.rbacRole.create({
      data: { id: r.id, name: r.name, isSystem: true, createdAt: now, updatedAt: now, permissions: { create: ids.map(permissionId => ({ permissionId })) } },
    })
  }
}

let seq = 0
async function userWithRole(roleId: string, tenantId: string): Promise<string> {
  const id = `u${++seq}`
  await prismaTest.user.create({ data: { id, email: `${id}@example.com`, tenantId, createdAt: now, updatedAt: now } })
  await prismaTest.userTenant.create({ data: { userId: id, tenantId, isDefault: true, joinedAt: now } })
  await prismaTest.rbacUserRole.create({ data: { id: `g${seq}`, userId: id, roleId, scopeType: 'global', tenantId, grantedAt: now } })
  return id
}

function asSession(id: string, tenantId: string) {
  headersMock.mockResolvedValue(new Headers())
  sessionMock.mockResolvedValue({ user: { id, email: `${id}@example.com`, tenantId } })
}

const RULE = { name: 'r', category: 'task', level: 'error', severity: 'warning', connection_id: '' }
const SCHEDULE = { name: 's', type: 'inventory', frequency: 'weekly', time_of_day: '06:00', connection_ids: [], recipients: ['x@example.com'] }
const REPORT = { type: 'inventory', name: 'r', connection_ids: [], date_from: '2026-11-01', date_to: '2026-11-02' }

const req = (method: string, body?: unknown) =>
  new Request('http://t/api/v1/orchestrator/x', {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  }) as any
const p = (id: string) => ({ params: Promise.resolve({ id }) })

/** Every write route of the two families, in one table. */
const WRITES: { name: string; family: 'alerts' | 'reports'; call: () => Promise<Response> }[] = [
  { name: 'POST alerts/rules', family: 'alerts', call: () => rules.POST(req("POST", RULE)) },
  { name: 'PUT alerts/rules/[id]', family: 'alerts', call: () => rule.PUT(req('PUT', RULE), p('rule-1')) },
  { name: 'DELETE alerts/rules/[id]', family: 'alerts', call: () => rule.DELETE(req('DELETE'), p('rule-1')) },
  { name: 'POST alerts/rules/[id]/toggle', family: 'alerts', call: () => toggle.POST(req('POST'), p('rule-1')) },
  { name: 'POST reports', family: 'reports', call: () => reports.POST(req("POST", REPORT)) },
  { name: 'DELETE reports/[id]', family: 'reports', call: () => report.DELETE(req('DELETE'), p('rep-1')) },
  { name: 'POST reports/schedules', family: 'reports', call: () => schedules.POST(req("POST", SCHEDULE)) },
  { name: 'PUT reports/schedules/[id]', family: 'reports', call: () => schedule.PUT(req('PUT', SCHEDULE), p('sch-1')) },
  { name: 'DELETE reports/schedules/[id]', family: 'reports', call: () => schedule.DELETE(req('DELETE'), p('sch-1')) },
  { name: 'POST reports/schedules/[id]/run', family: 'reports', call: () => run.POST(req('POST'), p('sch-1')) },
]

beforeEach(async () => {
  vi.clearAllMocks()
  orchestratorFetchMock.mockImplementation(async (path: string) => {
    if (path.startsWith('/alerts/rules/')) return { id: 'rule-1', name: 'r' }
    if (path.startsWith('/reports/schedules/')) return { id: 'sch-1', tenant_id: 'default', connection_ids: [] }
    if (path.startsWith('/reports/')) return { id: 'rep-1', tenant_id: 'default', connection_ids: [] }
    return { id: 'new-1' }
  })
  await truncate(['audit_logs', 'alert_rule_owners', 'rbac_user_roles', 'rbac_role_permissions', 'user_tenants', 'users', 'tenants'])
  await prismaTest.rbacRole.deleteMany({})
  await seedDefaultTenant()
  await prismaTest.tenant.create({ data: { id: TENANT, slug: TENANT, name: 'ACME', operatingModel: 'iaas', createdAt: now, updatedAt: now } })
  await seedCatalogue()
})

describe.each([
  ['Viewer', 'role_viewer', 'default'],
  ['Tenant Viewer', 'role_tenant_viewer', TENANT],
  ['Tenant Operator', 'role_tenant_operator', TENANT],
])('%s (read-only on alert rules and reports)', (_label, roleId, tenantId) => {
  it.each(WRITES.map(w => [w.name, w] as const))('%s answers 403 without calling the orchestrator', async (_n, w) => {
    asSession(await userWithRole(roleId, tenantId), tenantId)
    const res = await w.call()
    expect(res.status).toBe(403)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })
})

describe('roles that hold the write right get past the guard', () => {
  it.each(WRITES.map(w => [w.name, w] as const))('VM Admin: %s', async (_n, w) => {
    asSession(await userWithRole('role_vm_admin', 'default'), 'default')
    const res = await w.call()
    expect(res.status).not.toBe(403)
    expect(orchestratorFetchMock).toHaveBeenCalled()
  })

  it.each(WRITES.filter(w => w.family === 'reports').map(w => [w.name, w] as const))('Operator: %s', async (_n, w) => {
    asSession(await userWithRole('role_operator', 'default'), 'default')
    expect((await w.call()).status).not.toBe(403)
    expect(orchestratorFetchMock).toHaveBeenCalled()
  })

  it.each(WRITES.filter(w => w.family === 'alerts').map(w => [w.name, w] as const))('Operator (no alerts.manage): %s answers 403', async (_n, w) => {
    asSession(await userWithRole('role_operator', 'default'), 'default')
    expect((await w.call()).status).toBe(403)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })

  it('Tenant Admin passes the alert rule and report guards', async () => {
    const id = await userWithRole('role_tenant_admin', TENANT)
    asSession(id, TENANT)
    for (const w of WRITES) {
      const res = await w.call()
      expect(res.status, w.name).not.toBe(403)
    }
  })
})

describe('reports.manage in the system catalogue', () => {
  it('is held by the write roles and by none of the read-only ones', () => {
    const holds = (id: string) => {
      const r = ROLES.find(x => x.id === id)!
      return r.permissions.includes('*') || r.permissions.includes('reports.manage')
    }
    for (const id of ['role_super_admin', 'role_provider_admin', 'role_operator', 'role_vm_admin', 'role_tenant_admin']) {
      expect(holds(id), id).toBe(true)
    }
    for (const id of ['role_viewer', 'role_vm_user', 'role_tenant_operator', 'role_tenant_viewer']) {
      expect(holds(id), id).toBe(false)
    }
    expect(ALL_PERMISSIONS.find(x => x.id === 'reports.manage')?.isDangerous).toBe(true)
  })
})
