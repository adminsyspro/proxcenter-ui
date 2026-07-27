import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

vi.mock('@/lib/auth/requireEnterprise', () => ({
  requireFeature: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/orchestrator/headers', () => ({
  orchestratorHeaders: (extra: Record<string, string> = {}) => ({ 'X-API-Key': 'test', ...extra }),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => vi.clearAllMocks())

describe('POST /api/v1/ha/validate', () => {
  it('proxies validation to orchestrator', async () => {
    const mockResult = {
      results: [
        {
          ip: '192.0.2.101',
          ssh: true,
          docker: true,
          dockerVersion: '27.1.1',
          dockerCompose: true,
          watchdog: true,
          pgCompatible: true,
          ping: { '192.0.2.102': true, '192.0.2.103': true },
        },
      ],
      global: { vipAvailable: true },
    }
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResult,
    })

    const { POST } = await import('./route')
    const res = await callRoute(POST as any, {
      body: {
        nodes: [{ ip: '192.0.2.101', password: 'pass1' }],
        vip: '192.0.2.100',
      },
    })
    const data = await readJson(res)

    expect(res.status).toBe(200)
    expect(data).toEqual(mockResult)
  })

  it('returns 503 when orchestrator unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { body: {} })

    expect(res.status).toBe(503)
  })
})
