import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

const requireProviderAdminMock = vi.fn()
vi.mock('@/lib/tenant/providerGuard', () => ({
  requireProviderAdmin: (...args: unknown[]) => requireProviderAdminMock(...args),
}))

const requireFeatureMock = vi.fn()
vi.mock('@/lib/auth/requireEnterprise', () => ({
  requireFeature: (...args: unknown[]) => requireFeatureMock(...args),
}))

vi.mock('@/lib/orchestrator/headers', () => ({
  orchestratorHeaders: (extra: Record<string, string> = {}) => ({ 'X-API-Key': 'test', ...extra }),
}))

const auditMock = vi.fn(async (_entry: Record<string, unknown>) => 'audit-id')
vi.mock('@/lib/audit', () => ({ audit: auditMock }))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  vi.clearAllMocks()
  requireFeatureMock.mockResolvedValue(null)
  requireProviderAdminMock.mockResolvedValue(null)
})

describe('POST /api/v1/ha/security-upgrade', () => {
  it('proxies the upgrade request to the orchestrator', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 202, json: async () => ({ status: 'started' }) })

    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { method: 'POST', body: {} })

    expect(res.status).toBe(202)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/ha/security-upgrade'),
      expect.objectContaining({ method: 'POST' })
    )
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toMatchObject({ category: 'system', action: 'execute', resourceType: 'ha' })
  })

  it('passes a 409 from the orchestrator through with its message', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'an operation is in progress' }) })

    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { method: 'POST', body: {} })

    expect(res.status).toBe(409)
  })

  it('answers 403 when the HA capability is missing and never reaches the orchestrator', async () => {
    requireFeatureMock.mockResolvedValue(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }))

    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { method: 'POST', body: {} })

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a caller that is not a provider admin', async () => {
    requireProviderAdminMock.mockResolvedValue(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }))

    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { method: 'POST', body: {} })

    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
