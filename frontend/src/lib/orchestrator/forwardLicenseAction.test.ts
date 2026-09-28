import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { checkPermissionMock, fetchMock, headersMock, requireProviderTenantMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  requireProviderTenantMock: vi.fn(),
  fetchMock: vi.fn(),
  headersMock: vi.fn(() => ({ 'X-API-Key': 'test-key' })),
}))

vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/tenant', () => ({ requireProviderTenant: requireProviderTenantMock }))
vi.mock('@/lib/orchestrator/headers', () => ({ orchestratorHeaders: headersMock }))

import { forwardLicenseAction } from './forwardLicenseAction'

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  requireProviderTenantMock.mockReset().mockResolvedValue(null)
  fetchMock.mockReset()
  headersMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('forwardLicenseAction compatibility', () => {
  it('skips the provider-tenant gate unless providerOnly is set', async () => {
    fetchMock.mockResolvedValue(new Response('{"success":true}', { status: 200 }))
    await forwardLicenseAction('/api/v1/license/request', 'GET', 'request generation')
    expect(requireProviderTenantMock).not.toHaveBeenCalled()
  })

  it('answers the provider-tenant refusal as-is when providerOnly is set', async () => {
    const refusal = Response.json({ error: 'This operation is only available from the provider tenant' }, { status: 403 })
    requireProviderTenantMock.mockResolvedValue(refusal)
    const res = await forwardLicenseAction('/api/v1/license/connect', 'POST', 'connect', { providerOnly: true })
    expect(res).toBe(refusal)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('runs the permission check after a passing provider-tenant gate', async () => {
    fetchMock.mockResolvedValue(new Response('{"success":true}', { status: 200 }))
    const res = await forwardLicenseAction('/api/v1/license/connect', 'POST', 'connect', { providerOnly: true })
    expect(requireProviderTenantMock).toHaveBeenCalledOnce()
    expect(checkPermissionMock).toHaveBeenCalledWith('admin.settings')
    expect(res.status).toBe(200)
  })

  it('checks admin.settings and sends authenticated, uncached requests', async () => {
    fetchMock.mockResolvedValue(new Response('{"success":true}', { status: 201 }))
    const res = await forwardLicenseAction('/api/v1/license/connect', 'POST', 'connect')
    expect(checkPermissionMock).toHaveBeenCalledWith('admin.settings')
    expect(headersMock).toHaveBeenCalledWith()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v1\/license\/connect$/), {
      method: 'POST', headers: { 'X-API-Key': 'test-key' }, cache: 'no-store',
    })
    expect(res.status).toBe(200)
  })

  it('includes nonempty portal codes on action errors', async () => {
    const body = { success: false, error: 'portal refused', code: 'PORTAL_UNREACHABLE', portal_code: 'CLOCK_SKEW' }
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 502 }))
    const res = await forwardLicenseAction('/api/v1/license/connect', 'POST', 'connect')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual(body)
  })

  it.each([200, 502])('preserves malformed JSON handling for status %s', async (status) => {
    fetchMock.mockResolvedValue(new Response('not JSON', { status }))
    const res = await forwardLicenseAction('/api/v1/license/connect', 'POST', 'connect')
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual(status === 200 ? null : { success: false, error: 'HTTP 502' })
  })

  it('keeps the request download bytes, default filename, headers and status', async () => {
    const { GET } = await import('@/app/api/v1/license/request/route')
    const body = '{\n  "format": 1, "request": "AAA", "signature": "BBB"\n}\n'
    fetchMock.mockResolvedValue(new Response(body, { status: 201 }))
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(body)
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="proxcenter-license-request.json"')
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it.each([
    ['not JSON', { success: false, error: 'HTTP 502' }],
    ['{"error":"portal refused","code":"PORTAL_UNREACHABLE","portal_code":"CLOCK_SKEW"}', { success: false, error: 'portal refused', code: 'PORTAL_UNREACHABLE' }],
  ])('preserves request error normalization for %s', async (body, expected) => {
    const { GET } = await import('@/app/api/v1/license/request/route')
    fetchMock.mockResolvedValue(new Response(body, { status: 502 }))
    const res = await GET()
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual(expected)
  })

  it.each(['ECONNREFUSED', 'ENOTFOUND'])('maps %s to the exact unavailable response', async (message) => {
    fetchMock.mockRejectedValue(new Error(message))
    const res = await forwardLicenseAction('/api/v1/license/connect', 'DELETE', 'disconnect')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ success: false, error: 'The ProxCenter backend (orchestrator) is not reachable.', code: 'ORCHESTRATOR_UNAVAILABLE' })
  })

  it.each(['permission failed', ''])('keeps permission exceptions inside the proxy catch (%s)', async (message) => {
    checkPermissionMock.mockRejectedValue(new Error(message))
    const res = await forwardLicenseAction('/api/v1/license/connect', 'DELETE', 'disconnect')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ success: false, error: message || 'Failed to disconnect' })
    expect(console.error).toHaveBeenCalledWith('License disconnect failed:', message)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retains the request-specific fallback error and log label', async () => {
    const { GET } = await import('@/app/api/v1/license/request/route')
    fetchMock.mockRejectedValue(new Error(''))
    const res = await GET()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ success: false, error: 'Failed to generate the license request' })
    expect(console.error).toHaveBeenCalledWith('License request generation failed:', '')
  })
})
