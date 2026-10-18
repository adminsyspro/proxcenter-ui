import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getPrincipalMock, checkPermissionMock, vdcFindUniqueMock, getVdcScopeMock, getTenantInfrastructureScopeMock } = vi.hoisted(() => ({
  getPrincipalMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  vdcFindUniqueMock: vi.fn(),
  getVdcScopeMock: vi.fn(),
  getTenantInfrastructureScopeMock: vi.fn(),
}))

vi.mock('@/lib/auth/principal', () => ({ getPrincipal: (...a: any[]) => getPrincipalMock(...a) }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { vdc: { findUnique: (...a: any[]) => vdcFindUniqueMock(...a) } } }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: (...a: any[]) => getTenantInfrastructureScopeMock(...a),
}))
vi.mock('./scope', () => ({ getVdcScope: (...a: any[]) => getVdcScopeMock(...a) }))

import { resolveProviderVdcTarget, resolveScopeTenant, scopeTenantInfrastructure } from './providerTarget'

const providerSession = { ok: true, principal: { kind: 'session', tenantId: 'default', userId: 'u1' } }
const vdcRow = {
  id: 'vdc-1',
  name: 'Gold',
  tenantId: 't-acme',
  connectionId: 'conn-1',
  enabled: true,
  tenant: { name: 'Acme', enabled: true },
}

beforeEach(() => {
  vi.clearAllMocks()
  getPrincipalMock.mockResolvedValue(providerSession)
  checkPermissionMock.mockResolvedValue(null)
  vdcFindUniqueMock.mockResolvedValue(vdcRow)
})

describe('resolveProviderVdcTarget', () => {
  it('refuses with 403 when the principal cannot be resolved', async () => {
    getPrincipalMock.mockResolvedValue({ ok: false })
    const r = await resolveProviderVdcTarget('vdc-1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(403)
    expect(vdcFindUniqueMock).not.toHaveBeenCalled()
  })

  it('refuses with 403 for a token principal', async () => {
    getPrincipalMock.mockResolvedValue({ ok: true, principal: { kind: 'token', tenantId: 'default' } })
    const r = await resolveProviderVdcTarget('vdc-1')
    expect(!r.ok && r.response.status).toBe(403)
  })

  it('refuses with 403 for a session of a non-provider tenant, before any permission or db check', async () => {
    getPrincipalMock.mockResolvedValue({ ok: true, principal: { kind: 'session', tenantId: 't-acme' } })
    const r = await resolveProviderVdcTarget('vdc-1')
    expect(!r.ok && r.response.status).toBe(403)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(vdcFindUniqueMock).not.toHaveBeenCalled()
  })

  it('returns the permission denial when admin.settings is missing', async () => {
    const denial = Response.json({ error: 'forbidden' }, { status: 403 })
    checkPermissionMock.mockResolvedValue(denial)
    const r = await resolveProviderVdcTarget('vdc-1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response).toBe(denial)
    expect(checkPermissionMock).toHaveBeenCalledWith('admin.settings')
    expect(vdcFindUniqueMock).not.toHaveBeenCalled()
  })

  it.each([
    ['missing vDC', null],
    ['enabled null', { ...vdcRow, enabled: null }],
    ['disabled vDC', { ...vdcRow, enabled: false }],
    ['disabled tenant', { ...vdcRow, tenant: { name: 'Acme', enabled: false } }],
    ['no tenant', { ...vdcRow, tenant: null }],
    ['provider-owned vDC', { ...vdcRow, tenantId: 'default' }],
  ])('refuses with 404: %s', async (_label, row) => {
    vdcFindUniqueMock.mockResolvedValue(row)
    const r = await resolveProviderVdcTarget('vdc-1')
    expect(!r.ok && r.response.status).toBe(404)
  })

  it('returns the resolved target for an enabled tenant vDC', async () => {
    const r = await resolveProviderVdcTarget('vdc-1')
    expect(r).toEqual({
      ok: true,
      response: null,
      target: { vdcId: 'vdc-1', vdcName: 'Gold', tenantId: 't-acme', tenantName: 'Acme', connectionId: 'conn-1' },
    })
    expect(vdcFindUniqueMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'vdc-1' } }))
  })
})

describe('resolveScopeTenant', () => {
  const currentTenant = vi.fn()
  const req = (qs = '') => new Request(`http://localhost/api/x${qs}`)

  beforeEach(() => {
    currentTenant.mockReset().mockResolvedValue('t-caller')
  })

  it('uses the caller tenant when no target is given', async () => {
    const r = await resolveScopeTenant(req(), 'conn-1', currentTenant)
    expect(r).toEqual({ ok: true, tenantId: 't-caller', target: null, response: null })
    expect(getPrincipalMock).not.toHaveBeenCalled()
  })

  it('uses the target tenant for an authorised provider', async () => {
    const r = await resolveScopeTenant(req('?targetVdcId=vdc-1'), 'conn-1', currentTenant)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.tenantId).toBe('t-acme')
      expect(r.target?.vdcId).toBe('vdc-1')
    }
    expect(currentTenant).not.toHaveBeenCalled()
  })

  it('accepts any connection when the route has none to compare', async () => {
    const r = await resolveScopeTenant(req('?targetVdcId=vdc-1'), null, currentTenant)
    expect(r.ok).toBe(true)
  })

  it('propagates a refusal from the guard', async () => {
    getPrincipalMock.mockResolvedValue({ ok: true, principal: { kind: 'session', tenantId: 't-acme' } })
    const r = await resolveScopeTenant(req('?targetVdcId=vdc-1'), 'conn-1', currentTenant)
    expect(!r.ok && r.response.status).toBe(403)
  })

  it('refuses with 400 when the target vDC is on another connection', async () => {
    const r = await resolveScopeTenant(req('?targetVdcId=vdc-1'), 'conn-2', currentTenant)
    expect(!r.ok && r.response.status).toBe(400)
  })
})

describe('scopeTenantInfrastructure', () => {
  it('delegates to the tenant infrastructure scope without a target', async () => {
    const infra = { kind: 'provider' }
    getTenantInfrastructureScopeMock.mockResolvedValue(infra)
    const r = await scopeTenantInfrastructure({ tenantId: 't-caller', target: null })
    expect(r).toBe(infra)
    expect(getTenantInfrastructureScopeMock).toHaveBeenCalledWith('t-caller')
    expect(getVdcScopeMock).not.toHaveBeenCalled()
  })

  it('builds an iaas scope from the whole vDC scope of the target tenant', async () => {
    const vdcScope = { vdcId: 'vdc-1' }
    getVdcScopeMock.mockResolvedValue(vdcScope)
    const target = { vdcId: 'vdc-1', vdcName: 'Gold', tenantId: 't-acme', tenantName: 'Acme', connectionId: 'conn-1' }
    const r = await scopeTenantInfrastructure({ tenantId: 't-acme', target })
    expect(r).toEqual({ kind: 'iaas', vdcScope })
    expect(getVdcScopeMock).toHaveBeenCalledWith('t-acme', { ignoreVdcContext: true })
    expect(getTenantInfrastructureScopeMock).not.toHaveBeenCalled()
  })

  it('throws when the target tenant scope cannot be resolved', async () => {
    getVdcScopeMock.mockResolvedValue(null)
    const target = { vdcId: 'vdc-1', vdcName: 'Gold', tenantId: 't-acme', tenantName: 'Acme', connectionId: 'conn-1' }
    await expect(scopeTenantInfrastructure({ tenantId: 't-acme', target })).rejects.toThrow('Tenant vDC scope not resolved')
  })
})
