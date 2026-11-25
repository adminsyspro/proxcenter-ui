import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const requireProviderAdminMock = vi.fn().mockResolvedValue(null)
const requireFeatureMock = vi.fn().mockResolvedValue(null)

vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

vi.mock('@/lib/tenant/providerGuard', () => ({ requireProviderAdmin: requireProviderAdminMock }))

// Read-only route: no license guard. Kept mocked so the "not called"
// assertion fails loudly if a guard is ever added.
vi.mock('@/lib/auth/requireEnterprise', () => ({
  requireFeature: requireFeatureMock,
}))

vi.mock('@/lib/orchestrator/headers', () => ({
  orchestratorHeaders: (extra: Record<string, string> = {}) => ({ 'X-API-Key': 'test', ...extra }),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderAdminMock.mockResolvedValue(null)
  requireFeatureMock.mockResolvedValue(null)
})

describe('GET /api/v1/ha/images', () => {
  it('returns the image status of the nodes', async () => {
    const status = {
      etcd: 'v3.5.36', haproxy: '3.4.8-alpine', outdated: true, checkedAt: '2026-11-25T12:00:00Z',
      nodes: [{ node: 'proxcenter-1', etcd: 'v3.5.17', haproxy: '2.9-alpine', outdated: true }],
    }
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => status })

    const { GET } = await import('./route')
    const res = await callRoute(GET as any)

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual(status)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/ha/images'), expect.anything())
    expect(requireFeatureMock).not.toHaveBeenCalled()
  })

  it('rejects a caller that is not a provider admin and never reaches the orchestrator', async () => {
    requireProviderAdminMock.mockResolvedValue(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }))

    const { GET } = await import('./route')
    const res = await callRoute(GET as any)

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
