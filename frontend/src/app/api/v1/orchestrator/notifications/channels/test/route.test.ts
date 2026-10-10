/**
 * The "Send test" relay (roadmap#47): the orchestrator's { success, error }
 * answer, which carries the exact delivery error, reaches the dialog as is.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const { orchestratorFetchMock, checkPermissionMock, requireProviderTenantMock } = vi.hoisted(() => ({
  orchestratorFetchMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  requireProviderTenantMock: vi.fn(),
}))

vi.mock('@/lib/orchestrator', async orig => ({
  ...(await orig<typeof import('@/lib/orchestrator')>()),
  orchestratorFetch: (...a: any[]) => orchestratorFetchMock(...a),
}))

vi.mock('@/lib/tenant', () => ({
  requireProviderTenant: (...a: any[]) => requireProviderTenantMock(...a),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  requireProviderTenantMock.mockResolvedValue(null)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/v1/orchestrator/notifications/channels/test', () => {
  it('requires the admin settings permission', async () => {
    const denied = new Response(null, { status: 403 })

    checkPermissionMock.mockResolvedValue(denied)

    const { POST } = await import('./route')
    const res = await callRoute(POST, { method: 'POST', body: { name: 'x' } })

    expect(res).toBe(denied)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })

  it('relays a failed test with the exact error in a 200', async () => {
    orchestratorFetchMock.mockResolvedValue({ success: false, error: 'target 10.42.0.12 is a private address: refused unless the channel allows private networks' })

    const body = { id: 'c1', name: 'Lab', type: 'ntfy', url: '', allow_private_network: false }
    const { POST } = await import('./route')
    const res = await callRoute(POST, { method: 'POST', body })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: false, error: 'target 10.42.0.12 is a private address: refused unless the channel allows private networks' })
    expect(orchestratorFetchMock).toHaveBeenCalledWith('/notifications/channels/test', { method: 'POST', body })
  })

  it('relays a successful test', async () => {
    orchestratorFetchMock.mockResolvedValue({ success: true, message: 'Test message delivered' })

    const { POST } = await import('./route')
    const res = await callRoute(POST, { method: 'POST', body: { name: 'Lab', type: 'slack', url: 'https://hooks.slack.com/services/x' } })

    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it('passes an upstream validation error through as a 400', async () => {
    orchestratorFetchMock.mockRejectedValue(new Error('Orchestrator 400: {"error":"url is required"}'))

    const { POST } = await import('./route')
    const res = await callRoute(POST, { method: 'POST', body: { name: 'Lab', type: 'slack', url: '' } })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('url is required')
  })
})

describe('POST /api/v1/orchestrator/notifications/channels/test failures', () => {
  it('is refused outside the provider tenant', async () => {
    const gate = new Response(null, { status: 403 })

    requireProviderTenantMock.mockResolvedValue(gate)

    const { POST } = await import('./route')
    const res = await callRoute(POST, { method: 'POST', body: { type: 'slack' } })

    expect(res).toBe(gate)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })

  it('answers 500 without logging when the orchestrator is unreachable', async () => {
    const err: any = new Error('Orchestrator unavailable')

    err.code = 'ORCHESTRATOR_UNAVAILABLE'
    orchestratorFetchMock.mockRejectedValue(err)

    const { POST } = await import('./route')
    const res = await callRoute(POST, { method: 'POST', body: { type: 'slack' } })

    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Orchestrator unavailable')
    expect(console.error).not.toHaveBeenCalled()
  })

  it('logs and answers 500 on an upstream 5xx', async () => {
    orchestratorFetchMock.mockRejectedValue(new Error('Orchestrator 502: bad gateway'))

    const { POST } = await import('./route')
    const res = await callRoute(POST, { method: 'POST', body: { type: 'slack' } })

    expect(res.status).toBe(500)
    expect(console.error).toHaveBeenCalledWith('Failed to test notification channel', expect.any(Error))
  })
})
