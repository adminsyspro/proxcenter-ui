/**
 * The platform status describes the whole installation: provider
 * administrators only, and nothing is read for anyone else.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { requireFeatureMock, requireProviderAdminMock, buildPlatformStatusMock } = vi.hoisted(() => ({
  requireFeatureMock: vi.fn(),
  requireProviderAdminMock: vi.fn(),
  buildPlatformStatusMock: vi.fn()
}))

vi.mock('@/lib/rbac', () => ({ PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/tenant/providerGuard', () => ({ requireProviderAdmin: (...a: any[]) => requireProviderAdminMock(...a) }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ requireFeature: (...a: any[]) => requireFeatureMock(...a) }))
vi.mock('@/lib/platform/status', () => ({ buildPlatformStatus: (...a: any[]) => buildPlatformStatusMock(...a) }))

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderAdminMock.mockResolvedValue(null)
  requireFeatureMock.mockResolvedValue(null)
  buildPlatformStatusMock.mockResolvedValue({ overall: 'up', services: [] })
})

describe('GET /api/v1/system/status', () => {
  it('answers a provider administrator', async () => {
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, { method: 'GET' })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ overall: 'up', services: [] })
    expect(requireProviderAdminMock).toHaveBeenCalledWith('admin.settings')
  })

  it('refuses anyone else without reading anything', async () => {
    requireProviderAdminMock.mockResolvedValue(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, { method: 'GET' })

    expect(res.status).toBe(403)
    expect(buildPlatformStatusMock).not.toHaveBeenCalled()
  })

  it('is an Enterprise capability: refused without the platform_status feature', async () => {
    requireFeatureMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Enterprise feature' }), { status: 403 }))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, { method: 'GET' })

    expect(res.status).toBe(403)
    expect(requireFeatureMock).toHaveBeenCalledWith('platform_status')
    expect(buildPlatformStatusMock).not.toHaveBeenCalled()
  })
})
