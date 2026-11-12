import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  principal: vi.fn(),
  feature: vi.fn(),
  tenant: vi.fn(),
  permission: vi.fn(),
}))

vi.mock('@/lib/auth/principal', () => ({ getPrincipal: () => m.principal() }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: (...a: unknown[]) => m.feature(...a) }))
vi.mock('@/lib/license/features', () => ({ Features: { GPU_MANAGEMENT: 'gpu_management' } }))
vi.mock('@/lib/rbac', () => ({ checkPermission: (...a: unknown[]) => m.permission(...a) }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default', getCurrentTenantId: () => m.tenant() }))
vi.mock('./metrics', () => ({
  gpuCode: (code: string, status: number) => new Response(JSON.stringify({ code }), { status }),
  gpuFeatureRequired: () => new Response(JSON.stringify({ code: 'feature_required' }), { status: 403 }),
}))

import { requireGpuQuotaAccess } from './quotaGuard'

const session = { ok: true, principal: { kind: 'session', userId: 'u1', tenantId: 'default', connectionIds: null } }
const token = { ok: true, principal: { kind: 'token', tokenId: 't1', tenantId: 'default', connectionIds: null } }

beforeEach(() => {
  vi.clearAllMocks()
  m.principal.mockResolvedValue(session)
  m.feature.mockResolvedValue(true)
  m.tenant.mockResolvedValue('default')
  m.permission.mockResolvedValue(null)
})

describe('requireGpuQuotaAccess', () => {
  it('lets a provider session or token through on the given permission', async () => {
    expect(await requireGpuQuotaAccess('admin.settings.vdcs')).toBeNull()
    m.principal.mockResolvedValue(token)
    expect(await requireGpuQuotaAccess('admin.settings.view')).toBeNull()
    expect(m.permission).toHaveBeenNthCalledWith(1, 'admin.settings.vdcs')
    expect(m.permission).toHaveBeenNthCalledWith(2, 'admin.settings.view')
  })

  it('401 without a principal or a session user', async () => {
    m.principal.mockResolvedValue({ ok: false })
    expect((await requireGpuQuotaAccess('admin.settings.view'))?.status).toBe(401)
    m.principal.mockResolvedValue({ ok: true, principal: { kind: 'session', tenantId: 'default', connectionIds: null } })
    expect((await requireGpuQuotaAccess('admin.settings.view'))?.status).toBe(401)
  })

  it('404 for another tenant, by principal or by current tenant, and when the tenant cannot be read', async () => {
    m.principal.mockResolvedValue({ ok: true, principal: { ...token.principal, tenantId: 'acme' } })
    expect((await requireGpuQuotaAccess('admin.settings.view'))?.status).toBe(404)
    m.principal.mockResolvedValue(session)
    m.tenant.mockResolvedValue('acme')
    expect((await requireGpuQuotaAccess('admin.settings.view'))?.status).toBe(404)
    m.tenant.mockRejectedValue(new Error('no tenant'))
    expect((await requireGpuQuotaAccess('admin.settings.view'))?.status).toBe(404)
    expect(m.permission).not.toHaveBeenCalled()
  })

  it('answers the licence refusal, then the permission refusal untouched', async () => {
    m.feature.mockResolvedValue(false)
    expect((await requireGpuQuotaAccess('admin.settings.view'))?.status).toBe(403)
    m.feature.mockResolvedValue(true)
    const denied = new Response(null, { status: 403 })
    m.permission.mockResolvedValue(denied)
    expect(await requireGpuQuotaAccess('admin.settings.vdcs')).toBe(denied)
  })
})
