/**
 * Notifications are global and the settings tab is provider-only (roadmap#47):
 * a tenant admin holds admin.settings too, so every notification relay also
 * checks the provider tenant before reaching the orchestrator.
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
  getTenantConnectionIds: vi.fn(async () => new Set<string>()),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

const gate = new Response(null, { status: 403 })

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  requireProviderTenantMock.mockResolvedValue(gate)
})

describe('notification relays outside the provider tenant', () => {
  it('refuses the history', async () => {
    const { GET } = await import('./history/route')

    expect(await callRoute(GET, { method: 'GET' })).toBe(gate)
  })

  it('refuses to read the settings', async () => {
    const { GET } = await import('./settings/route')

    expect(await GET()).toBe(gate)
  })

  it('refuses to change the settings', async () => {
    const { PUT } = await import('./settings/route')

    expect(await callRoute(PUT, { method: 'PUT', body: { enabled: true } })).toBe(gate)
  })

  it('refuses the SMTP connection test', async () => {
    const { POST } = await import('./test-connection/route')

    expect(await callRoute(POST, { method: 'POST', body: {} })).toBe(gate)
  })

  it('refuses the test notification', async () => {
    const { POST } = await import('./test/route')

    expect(await callRoute(POST, { method: 'POST', body: {} })).toBe(gate)
  })

  it('never reaches the orchestrator', () => {
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })
})
