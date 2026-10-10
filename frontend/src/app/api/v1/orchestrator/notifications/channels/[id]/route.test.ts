/**
 * The channel update/delete relays (roadmap#47): the id reaches the
 * orchestrator path encoded, a blank URL is forwarded untouched (the
 * orchestrator keeps the stored one), and an upstream 404 stays a 404.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const { orchestratorFetchMock, checkPermissionMock } = vi.hoisted(() => ({
  orchestratorFetchMock: vi.fn(),
  checkPermissionMock: vi.fn(),
}))

vi.mock('@/lib/orchestrator', async orig => ({
  ...(await orig<typeof import('@/lib/orchestrator')>()),
  orchestratorFetch: (...a: any[]) => orchestratorFetchMock(...a),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('PUT /api/v1/orchestrator/notifications/channels/[id]', () => {
  it('requires the admin settings permission', async () => {
    const denied = new Response(null, { status: 403 })

    checkPermissionMock.mockResolvedValue(denied)

    const { PUT } = await import('./route')
    const res = await callRoute(PUT, { method: 'PUT', params: { id: 'c1' }, body: { name: 'x' } })

    expect(res).toBe(denied)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })

  it('forwards the body to the channel path with the id encoded', async () => {
    orchestratorFetchMock.mockResolvedValue({ id: 'c 1', name: 'Ops 2' })

    const body = { name: 'Ops 2', type: 'slack', enabled: false, url: '', types: [], min_severity: 'critical' }
    const { PUT } = await import('./route')
    const res = await callRoute(PUT, { method: 'PUT', params: { id: 'c 1' }, body })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'c 1', name: 'Ops 2' })
    expect(orchestratorFetchMock).toHaveBeenCalledWith('/notifications/channels/c%201', { method: 'PUT', body })
  })

  it('keeps an upstream 404 a 404', async () => {
    orchestratorFetchMock.mockRejectedValue(new Error('Orchestrator 404: {"error":"notification channel not found"}'))

    const { PUT } = await import('./route')
    const res = await callRoute(PUT, { method: 'PUT', params: { id: 'nope' }, body: { name: 'x' } })

    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('notification channel not found')
  })
})

describe('DELETE /api/v1/orchestrator/notifications/channels/[id]', () => {
  it('relays the deletion', async () => {
    orchestratorFetchMock.mockResolvedValue({ status: 'deleted' })

    const { DELETE } = await import('./route')
    const res = await callRoute(DELETE, { method: 'DELETE', params: { id: 'c1' } })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'deleted' })
    expect(orchestratorFetchMock).toHaveBeenCalledWith('/notifications/channels/c1', { method: 'DELETE' })
  })

  it('requires the admin settings permission', async () => {
    const denied = new Response(null, { status: 403 })

    checkPermissionMock.mockResolvedValue(denied)

    const { DELETE } = await import('./route')
    const res = await callRoute(DELETE, { method: 'DELETE', params: { id: 'c1' } })

    expect(res).toBe(denied)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })
})
