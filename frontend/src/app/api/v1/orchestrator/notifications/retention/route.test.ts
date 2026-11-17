/**
 * The notification history retention is one value for the whole platform:
 * read and written by a provider administrator only, relayed to the
 * orchestrator as a whole number of days.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { requireProviderAdminMock, orchestratorFetchMock } = vi.hoisted(() => ({
  requireProviderAdminMock: vi.fn(),
  orchestratorFetchMock: vi.fn()
}))

vi.mock('@/lib/rbac', () => ({ PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/tenant/providerGuard', () => ({ requireProviderAdmin: (...a: any[]) => requireProviderAdminMock(...a) }))
vi.mock('@/lib/orchestrator/client', () => ({ orchestratorFetch: (...a: any[]) => orchestratorFetchMock(...a) }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn(async () => 'audit-id') }))

const FORBIDDEN = () => new Response(JSON.stringify({ error: 'provider only' }), { status: 403 })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  requireProviderAdminMock.mockResolvedValue(null)
  orchestratorFetchMock.mockResolvedValue({ status: 'ok', retentionDays: 30 })
})

describe('/api/v1/orchestrator/notifications/retention', () => {
  it('GET relays the retention to a provider administrator', async () => {
    orchestratorFetchMock.mockResolvedValue({ retentionDays: 30, maxRetentionDays: 365 })
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, { method: 'GET' })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ retentionDays: 30, maxRetentionDays: 365 })
    expect(requireProviderAdminMock).toHaveBeenCalledWith('admin.settings')
    expect(orchestratorFetchMock).toHaveBeenCalledWith('/notifications/retention')
  })

  it('GET and PUT refuse anyone else before reaching the orchestrator', async () => {
    requireProviderAdminMock.mockResolvedValue(FORBIDDEN())
    const { GET, PUT } = await import('./route')

    expect((await callRoute(GET as any, { method: 'GET' })).status).toBe(403)
    expect((await callRoute(PUT as any, { method: 'PUT', body: { retentionDays: 7 } })).status).toBe(403)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })

  it('PUT forwards only the retention', async () => {
    const { PUT } = await import('./route')
    const res = await callRoute(PUT as any, { method: 'PUT', body: { retentionDays: 7, other: 'x' } })

    expect(res.status).toBe(200)
    expect(orchestratorFetchMock).toHaveBeenCalledWith('/notifications/retention', { method: 'PUT', body: { retentionDays: 7 } })
  })

  it.each([[{ retentionDays: 1.5 }], [{ retentionDays: 'abc' }], [{ retentionDays: 0 }], [{}]])('PUT refuses %j', async body => {
    const { PUT } = await import('./route')
    const res = await callRoute(PUT as any, { method: 'PUT', body })

    expect(res.status).toBe(400)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })

  it('reports an orchestrator failure, quietly when it is merely unreachable', async () => {
    const { GET, PUT } = await import('./route')

    orchestratorFetchMock.mockRejectedValue(Object.assign(new Error('Orchestrator unavailable'), { code: 'ORCHESTRATOR_UNAVAILABLE' }))
    const down = await callRoute(GET as any, { method: 'GET' })

    expect(down.status).toBe(500)
    expect(await readJson(down)).toEqual({ error: 'Orchestrator unavailable' })
    expect(console.error).not.toHaveBeenCalled()

    orchestratorFetchMock.mockRejectedValue(new Error('Orchestrator 400: out of range'))
    expect((await callRoute(PUT as any, { method: 'PUT', body: { retentionDays: 9999 } })).status).toBe(500)
    expect(console.error).toHaveBeenCalled()
  })
})
