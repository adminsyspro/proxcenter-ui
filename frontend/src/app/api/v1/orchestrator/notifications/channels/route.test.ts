/**
 * The channel list/create relays (roadmap#47): admin gate, pass-through of
 * the orchestrator's answer, and the upstream validation message surfacing
 * as a 400 instead of a generic 500.
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

const CHANNEL = { id: 'c1', name: 'Ops', type: 'slack', enabled: true, url_masked: 'https://hooks.slack.com/services/***', has_secret: false }

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  requireProviderTenantMock.mockResolvedValue(null)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/v1/orchestrator/notifications/channels', () => {
  it('is refused outside the provider tenant', async () => {
    requireProviderTenantMock.mockResolvedValue(new Response(JSON.stringify({ error: 'provider only' }), { status: 403 }))

    const { GET } = await import('./route')
    const res = await GET()

    expect(res.status).toBe(403)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })


  it('requires the admin settings permission', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })

    checkPermissionMock.mockResolvedValue(denied)

    const { GET } = await import('./route')
    const res = await GET()

    expect(res).toBe(denied)
    expect(checkPermissionMock).toHaveBeenCalledWith('admin.settings')
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })

  it('relays the orchestrator list as is', async () => {
    orchestratorFetchMock.mockResolvedValue({ data: [CHANNEL] })

    const { GET } = await import('./route')
    const res = await GET()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: [CHANNEL] })
    expect(orchestratorFetchMock).toHaveBeenCalledWith('/notifications/channels')
  })

  it('answers 500 when the orchestrator is unreachable', async () => {
    const err: any = new Error('Orchestrator unavailable')

    err.code = 'ORCHESTRATOR_UNAVAILABLE'
    orchestratorFetchMock.mockRejectedValue(err)

    const { GET } = await import('./route')
    const res = await GET()

    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Orchestrator unavailable')
  })
})

describe('POST /api/v1/orchestrator/notifications/channels', () => {
  it('forwards the body (secrets included) and answers 201 with the masked channel', async () => {
    orchestratorFetchMock.mockResolvedValue(CHANNEL)

    const body = { name: 'Ops', type: 'slack', enabled: true, url: 'https://hooks.slack.com/services/T/B/secret', types: ['alert'], min_severity: 'warning' }
    const { POST } = await import('./route')
    const res = await callRoute(POST, { method: 'POST', body })

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual(CHANNEL)
    expect(orchestratorFetchMock).toHaveBeenCalledWith('/notifications/channels', { method: 'POST', body })
  })

  it('passes an upstream validation error through with its status and message', async () => {
    orchestratorFetchMock.mockRejectedValue(new Error('Orchestrator 400: {"error":"unknown channel type \\"pager\\""}'))

    const { POST } = await import('./route')
    const res = await callRoute(POST, { method: 'POST', body: { name: 'x', type: 'pager', url: 'https://x' } })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('unknown channel type "pager"')
  })

  it('does not pass an upstream 5xx through as a client error', async () => {
    orchestratorFetchMock.mockRejectedValue(new Error('Orchestrator 503: {"error":"Notification service not available"}'))

    const { POST } = await import('./route')
    const res = await callRoute(POST, { method: 'POST', body: { name: 'x' } })

    expect(res.status).toBe(500)
  })
})
