import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  tenant: vi.fn(),
  hasFeature: vi.fn(),
  checkPermission: vi.fn(),
  rbacScope: vi.fn(),
  infra: vi.fn(),
  findMany: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: () => m.session() }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: (id: string) => m.hasFeature(id) }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default', getCurrentTenantId: () => m.tenant() }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view', ALERTS_MANAGE: 'alerts.manage', ADMIN_SETTINGS: 'admin.settings' },
  checkPermission: (...a: unknown[]) => m.checkPermission(...a),
  getCurrentRbacInfraScope: (...a: unknown[]) => m.rbacScope(...a),
}))
vi.mock('@/lib/tenant/infraScope', async orig => ({
  ...(await orig<typeof import('@/lib/tenant/infraScope')>()),
  getTenantInfrastructureScope: (...a: unknown[]) => m.infra(...a),
}))
vi.mock('@/lib/db/prisma', () => ({ prisma: { connection: { findMany: (...a: unknown[]) => m.findMany(...a) } } }))

import { requireAvailabilitySettingsAccess, requireSlaManage, requireSlaRead } from './guard'

const denied = (status = 403) => NextResponse.json({ error: 'Permission denied' }, { status })

beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'u1', email: 'ops@lab', tenantId: 'default' } })
  m.tenant.mockResolvedValue('default')
  m.hasFeature.mockResolvedValue(true)
  m.checkPermission.mockResolvedValue(null)
  m.rbacScope.mockResolvedValue(null)
  m.infra.mockResolvedValue({ kind: 'provider' })
  m.findMany.mockImplementation(async ({ where }: { where: { id?: { in: string[] } } }) =>
    ['c1', 'c2'].filter(id => !where.id || where.id.in.includes(id)).map(id => ({ id })))
})

describe('requireSlaRead', () => {
  it('provider: every PVE connection, no perimeter', async () => {
    const access = await requireSlaRead()
    expect(access).toEqual({ denied: null, userId: 'u1', userEmail: 'ops@lab', tenantId: 'default', scope: null, connectionIds: ['c1', 'c2'] })
    expect(m.checkPermission).toHaveBeenCalledWith('connection.view')
    expect(m.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { type: 'pve' } }))
    expect(m.infra).toHaveBeenCalledWith('default', { ignoreVdcContext: false })
    expect(m.hasFeature).toHaveBeenCalledWith('sla_monitoring')
  })

  it('401 without a session, before anything else', async () => {
    m.session.mockResolvedValue(null)
    const access = await requireSlaRead()
    expect(access.denied?.status).toBe(401)
    expect(m.checkPermission).not.toHaveBeenCalled()
  })

  it('403 when the tenant of the session is refused', async () => {
    m.tenant.mockRejectedValue(new Error('Tenant not available'))
    expect((await requireSlaRead()).denied?.status).toBe(403)
  })

  it('relays the refusal of connection.view', async () => {
    m.checkPermission.mockResolvedValue(denied())
    expect((await requireSlaRead()).denied?.status).toBe(403)
    expect(m.infra).not.toHaveBeenCalled()
  })

  it('404 for a vDC (iaas) tenant, before reading any connection', async () => {
    m.tenant.mockResolvedValue('acme')
    m.infra.mockResolvedValue({ kind: 'iaas', vdcScope: {
      connectionIds: new Set(['c2']), nodesByConnection: new Map([['c2', new Set(['pve3'])]]), poolsByConnection: new Map([['c2', new Set(['acme'])]]),
    } })
    for (const guard of [requireSlaRead, requireSlaManage]) {
      const res = (await guard()).denied
      expect(res?.status).toBe(404)
      expect(await res?.json()).toEqual({ error: 'not_found' })
    }
    expect(m.findMany).not.toHaveBeenCalled()
  })

  it('narrows by the RBAC grants of connection.view', async () => {
    m.rbacScope.mockResolvedValue({ fullConnections: new Set(['c1']), nodesByConnection: new Map(), guestDerived: false })
    const access = await requireSlaRead()
    expect(m.rbacScope).toHaveBeenCalledWith('connection.view')
    expect(access.connectionIds).toEqual(['c1'])
    expect(access.scope).toEqual({ connections: { c1: { all: true } } })
  })

})

describe('requireSlaRead / requireSlaManage', () => {
  it('403 feature_required without sla_monitoring', async () => {
    m.hasFeature.mockResolvedValue(false)
    for (const guard of [requireSlaRead, requireSlaManage]) {
      const res = (await guard()).denied
      expect(res?.status).toBe(403)
      expect(await res?.json()).toEqual({ error: 'feature_required', feature: 'sla_monitoring' })
    }
    expect(m.checkPermission).not.toHaveBeenCalled()
    expect(m.findMany).not.toHaveBeenCalled()
  })

  it('manage: alerts.manage after the licence, over the full vDC union', async () => {
    const access = await requireSlaManage()
    expect(access.denied).toBeNull()
    expect(m.checkPermission).toHaveBeenCalledWith('alerts.manage')
    expect(m.infra).toHaveBeenCalledWith('default', { ignoreVdcContext: true })
    m.checkPermission.mockImplementation(async (p: string) => (p === 'alerts.manage' ? denied() : null))
    expect((await requireSlaManage()).denied?.status).toBe(403)
  })

  it('read does not need alerts.manage', async () => {
    m.checkPermission.mockImplementation(async (p: string) => (p === 'alerts.manage' ? denied() : null))
    expect((await requireSlaRead()).denied).toBeNull()
  })
})

describe('requireAvailabilitySettingsAccess', () => {
  it('provider with the licence and admin.settings', async () => {
    expect(await requireAvailabilitySettingsAccess()).toEqual({ denied: null })
    expect(m.checkPermission).toHaveBeenCalledWith('admin.settings')
  })

  it('404 for another tenant, on the session claim or the resolved tenant', async () => {
    m.session.mockResolvedValue({ user: { id: 'u1', tenantId: 'acme' } })
    const res = (await requireAvailabilitySettingsAccess()).denied
    expect(res?.status).toBe(404)
    expect(await res?.json()).toEqual({ error: 'not_found' })
    expect(m.hasFeature).not.toHaveBeenCalled()
    m.session.mockResolvedValue({ user: { id: 'u1' } })
    m.tenant.mockResolvedValue('acme')
    expect((await requireAvailabilitySettingsAccess()).denied?.status).toBe(404)
    m.tenant.mockRejectedValue(new Error('stale'))
    expect((await requireAvailabilitySettingsAccess()).denied?.status).toBe(404)
  })

  it('401 without a session, 403 without the licence or admin.settings', async () => {
    m.session.mockResolvedValue(null)
    expect((await requireAvailabilitySettingsAccess()).denied?.status).toBe(401)
    m.session.mockResolvedValue({ user: { id: 'u1', tenantId: 'default' } })
    m.hasFeature.mockResolvedValue(false)
    expect((await requireAvailabilitySettingsAccess()).denied?.status).toBe(403)
    m.hasFeature.mockResolvedValue(true)
    m.checkPermission.mockResolvedValue(denied())
    expect((await requireAvailabilitySettingsAccess()).denied?.status).toBe(403)
  })
})
