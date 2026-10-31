import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  tenant: vi.fn(),
  hasFeature: vi.fn(),
  checkPermission: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: () => m.session() }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: (id: string) => m.hasFeature(id) }))
vi.mock('@/lib/tenant', () => ({
  DEFAULT_TENANT_ID: 'default',
  getCurrentTenantId: () => m.tenant(),
}))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { ALERTS_VIEW: 'alerts.view', ALERTS_MANAGE: 'alerts.manage', ADMIN_SETTINGS: 'admin.settings' },
  checkPermission: (...a: unknown[]) => m.checkPermission(...a),
}))

import { requireIncidentAccess } from './guard'

const forbidden = () => NextResponse.json({ error: 'Permission denied' }, { status: 403 })

beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'u1', name: 'Ops', email: 'ops@lab', tenantId: 'default' } })
  m.tenant.mockResolvedValue('default')
  m.hasFeature.mockResolvedValue(true)
  m.checkPermission.mockResolvedValue(null)
})

describe('requireIncidentAccess', () => {
  it('401 without a session', async () => {
    m.session.mockResolvedValue(null)
    const access = await requireIncidentAccess('read')
    expect(access.denied?.status).toBe(401)
  })

  it('404 for a session of another tenant, before the licence and the permission', async () => {
    m.session.mockResolvedValue({ user: { id: 'u2', email: 'acme@x', tenantId: 'acme' } })
    const access = await requireIncidentAccess('read')
    expect(access.denied?.status).toBe(404)
    expect(await access.denied?.json()).toEqual({ error: 'not_found' })
    expect(m.hasFeature).not.toHaveBeenCalled()
    expect(m.checkPermission).not.toHaveBeenCalled()
  })

  it('404 when getCurrentTenantId says another tenant, whatever the session claim', async () => {
    m.tenant.mockResolvedValue('acme')
    expect((await requireIncidentAccess('read')).denied?.status).toBe(404)
  })

  it('404 when getCurrentTenantId throws', async () => {
    m.tenant.mockRejectedValue(new Error('no tenant'))
    expect((await requireIncidentAccess('write')).denied?.status).toBe(404)
  })

  it('403 feature_required without the incidents feature', async () => {
    m.hasFeature.mockResolvedValue(false)
    const access = await requireIncidentAccess('read')
    expect(access.denied?.status).toBe(403)
    expect(await access.denied?.json()).toEqual({ error: 'feature_required', feature: 'incidents' })
    expect(m.hasFeature).toHaveBeenCalledWith('incidents')
  })

  it.each([
    ['read', 'alerts.view'],
    ['write', 'alerts.manage'],
    ['admin', 'admin.settings'],
  ] as const)('%s asks %s', async (level, permission) => {
    await requireIncidentAccess(level)
    expect(m.checkPermission).toHaveBeenCalledWith(permission)
  })

  it('403 when the permission of the level is missing', async () => {
    m.checkPermission.mockImplementation(async (p: string) => (p === 'alerts.manage' ? forbidden() : null))
    expect((await requireIncidentAccess('write')).denied?.status).toBe(403)
    expect((await requireIncidentAccess('read')).denied).toBeNull()
  })

  it('the author is the session name, else its email', async () => {
    expect(await requireIncidentAccess('read')).toEqual({ denied: null, userId: 'u1', userName: 'Ops' })
    m.session.mockResolvedValue({ user: { id: 'u1', email: 'ops@lab', tenantId: 'default' } })
    expect(await requireIncidentAccess('read')).toMatchObject({ userName: 'ops@lab' })
  })
})
