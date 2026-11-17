/**
 * The host history is part of the platform status: provider administrators
 * only, over one of the three ranges the tab offers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { requireFeatureMock, requireProviderAdminMock, hostHistoryMock, startSamplerMock, readHostMock } = vi.hoisted(() => ({
  requireFeatureMock: vi.fn(),
  requireProviderAdminMock: vi.fn(),
  hostHistoryMock: vi.fn(),
  startSamplerMock: vi.fn(),
  readHostMock: vi.fn()
}))

vi.mock('@/lib/rbac', () => ({ PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/tenant/providerGuard', () => ({ requireProviderAdmin: (...a: any[]) => requireProviderAdminMock(...a) }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ requireFeature: (...a: any[]) => requireFeatureMock(...a) }))
vi.mock('@/lib/platform/sysinfo', () => ({ readHost: () => readHostMock() }))
vi.mock('@/lib/platform/history', () => ({
  HISTORY_RANGES: { '1h': 1, '6h': 6, '24h': 24 },
  hostHistory: (...a: any[]) => hostHistoryMock(...a),
  startHostHistorySampler: () => startSamplerMock()
}))

const HOST = { cpus: 8 }
const call = (query = '') => import('./route').then(({ GET }) => callRoute(GET as any, { method: 'GET', url: `http://localhost/api/v1/system/status/history${query}` }))

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderAdminMock.mockResolvedValue(null)
  requireFeatureMock.mockResolvedValue(null)
  readHostMock.mockResolvedValue(HOST)
  hostHistoryMock.mockImplementation((range: string) => ({ range, samples: [] }))
})

describe('GET /api/v1/system/status/history', () => {
  it('answers the last hour by default', async () => {
    const res = await call()

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ range: '1h', samples: [] })
    expect(hostHistoryMock).toHaveBeenCalledWith('1h', expect.any(Number), HOST)
    expect(requireProviderAdminMock).toHaveBeenCalledWith('admin.settings')
    expect(startSamplerMock).toHaveBeenCalled()
  })

  it.each(['1h', '6h', '24h'])('answers the %s range', async range => {
    expect(await readJson(await call(`?range=${range}`))).toMatchObject({ range })
  })

  it.each(['7d', '', 'constructor', '__proto__'])('refuses the range %j', async range => {
    const res = await call(`?range=${range}`)

    expect(res.status).toBe(400)
    expect(hostHistoryMock).not.toHaveBeenCalled()
  })

  it('refuses anyone but a provider administrator without reading anything', async () => {
    requireProviderAdminMock.mockResolvedValue(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }))
    const res = await call('?range=1h')

    expect(res.status).toBe(403)
    expect(hostHistoryMock).not.toHaveBeenCalled()
    expect(startSamplerMock).not.toHaveBeenCalled()
  })

  it('is an Enterprise capability: refused without the platform_status feature', async () => {
    requireFeatureMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Enterprise feature' }), { status: 403 }))
    const res = await call('?range=1h')

    expect(res.status).toBe(403)
    expect(requireFeatureMock).toHaveBeenCalledWith('platform_status')
    expect(hostHistoryMock).not.toHaveBeenCalled()
  })
})
