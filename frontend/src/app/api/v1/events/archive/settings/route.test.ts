/**
 * The retention of ProxCenter's task copy (#1225) is one value for the whole
 * fleet: readable with connection.view, written by a provider admin only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { checkPermissionMock, requireProviderAdminMock, orchestratorFetchMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  requireProviderAdminMock: vi.fn(),
  orchestratorFetchMock: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view', ADMIN_SETTINGS: 'admin.settings' },
}))
vi.mock('@/lib/tenant/providerGuard', () => ({ requireProviderAdmin: (...a: any[]) => requireProviderAdminMock(...a) }))
vi.mock('@/lib/orchestrator/client', () => ({ orchestratorFetch: (...a: any[]) => orchestratorFetchMock(...a) }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn(async () => 'audit-id') }))

const FORBIDDEN = () => new Response(JSON.stringify({ error: 'provider only' }), { status: 403 })

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  requireProviderAdminMock.mockResolvedValue(null)
  orchestratorFetchMock.mockResolvedValue({ status: 'ok', retentionDays: 30 })
})

describe('/api/v1/events/archive/settings', () => {
  it('GET reads the retention with connection.view', async () => {
    orchestratorFetchMock.mockResolvedValue({ retentionDays: 90, maxRetentionDays: 730 })
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, { method: 'GET' })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ retentionDays: 90, maxRetentionDays: 730 })
    expect(checkPermissionMock).toHaveBeenCalledWith('connection.view')
    expect(orchestratorFetchMock).toHaveBeenCalledWith('/task-history/settings')
  })

  it('GET refuses a caller without connection.view, and reports an orchestrator failure', async () => {
    const { GET } = await import('./route')

    checkPermissionMock.mockResolvedValue(new Response(null, { status: 403 }))
    expect((await callRoute(GET as any, { method: 'GET' })).status).toBe(403)

    checkPermissionMock.mockResolvedValue(null)
    orchestratorFetchMock.mockRejectedValue(new Error('down'))
    expect((await callRoute(GET as any, { method: 'GET' })).status).toBe(500)
  })

  it('PUT refuses anyone but a provider admin before reaching the orchestrator', async () => {
    requireProviderAdminMock.mockResolvedValue(FORBIDDEN())
    const { PUT } = await import('./route')
    const res = await callRoute(PUT as any, { method: 'PUT', body: { retentionDays: 30 } })

    expect(res.status).toBe(403)
    expect(requireProviderAdminMock).toHaveBeenCalledWith('admin.settings')
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })

  it('PUT forwards only the retention, as a whole number', async () => {
    const { PUT } = await import('./route')
    const res = await callRoute(PUT as any, { method: 'PUT', body: { retentionDays: 30, other: 'x' } })

    expect(res.status).toBe(200)
    expect(orchestratorFetchMock).toHaveBeenCalledWith('/task-history/settings', { method: 'PUT', body: { retentionDays: 30 } })

    orchestratorFetchMock.mockClear()
    expect((await callRoute(PUT as any, { method: 'PUT', body: { retentionDays: 'lots' } })).status).toBe(400)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()

    orchestratorFetchMock.mockRejectedValue(new Error('retentionDays must be between 1 and 730'))
    expect((await callRoute(PUT as any, { method: 'PUT', body: { retentionDays: 9000 } })).status).toBe(500)
  })
})
