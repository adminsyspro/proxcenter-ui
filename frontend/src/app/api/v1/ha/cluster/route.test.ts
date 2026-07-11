import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

vi.mock('@/lib/auth/requireEnterprise', () => ({
  requireEnterprise: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/orchestrator/headers', () => ({
  orchestratorHeaders: (extra: Record<string, string> = {}) => ({ 'X-API-Key': 'test', ...extra }),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => vi.clearAllMocks())

describe('GET /api/v1/ha/cluster', () => {
  it('returns cluster status', async () => {
    const mockCluster = {
      patroni: {
        scope: 'proxcenter',
        members: [
          { name: 'proxcenter-1', host: '10.24.24.101', role: 'leader', state: 'running', timeline: 4, lagBytes: 0 },
          { name: 'proxcenter-2', host: '10.24.24.102', role: 'sync_standby', state: 'streaming', timeline: 4, lagBytes: 0 },
          { name: 'proxcenter-3', host: '10.24.24.103', role: 'replica', state: 'streaming', timeline: 4, lagBytes: 0 },
        ],
        syncMode: 'synchronous_mode_strict',
        paused: false,
      },
      etcd: { healthy: true, members: [] },
      vip: { address: '10.24.24.100', holder: 'proxcenter-1' },
      services: {},
      history: [],
    }
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockCluster,
    })

    const { GET } = await import('./route')
    const res = await callRoute(GET as any)
    const data = await readJson(res)

    expect(res.status).toBe(200)
    expect((data as any).patroni.members).toHaveLength(3)
  })

  it('returns 503 when orchestrator unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    const { GET } = await import('./route')
    const res = await callRoute(GET as any)

    expect(res.status).toBe(503)
  })
})
