import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const { checkPermissionMock, tenantMock, orchestratorFetchMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  tenantMock: vi.fn(),
  orchestratorFetchMock: vi.fn(),
}))

vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: () => null }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default', getCurrentTenantId: () => tenantMock() }))
vi.mock('@/lib/orchestrator/client', () => ({ orchestratorFetch: (...a: any[]) => orchestratorFetchMock(...a) }))

import { POST } from './route'

const originalUrl = process.env.ORCHESTRATOR_URL

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  tenantMock.mockResolvedValue('default')
  orchestratorFetchMock.mockResolvedValue({})
  process.env.ORCHESTRATOR_URL = 'http://orchestrator.test'
})

afterEach(() => {
  process.env.ORCHESTRATOR_URL = originalUrl
})

async function post() {
  const res = await callRoute(POST as any, { method: 'POST' })
  return { status: res.status, body: await res.json() }
}

describe('POST /api/v1/orchestrator/sflow/health/check (roadmap#52)', () => {
  it('relays the request to the orchestrator and answers 202', async () => {
    expect(await post()).toEqual({ status: 202, body: { started: true } })
    expect(orchestratorFetchMock).toHaveBeenCalledWith('/sflow/health/check', { method: 'POST' })
  })

  it('does nothing without an orchestrator', async () => {
    delete process.env.ORCHESTRATOR_URL
    expect(await post()).toEqual({ status: 202, body: { started: false, reason: 'no_orchestrator' } })
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })

  it('answers 502 when the orchestrator cannot be reached, or fails', async () => {
    orchestratorFetchMock.mockRejectedValueOnce(Object.assign(new Error('down'), { code: 'ORCHESTRATOR_UNAVAILABLE' }))
    expect((await post()).status).toBe(502)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    orchestratorFetchMock.mockRejectedValueOnce(new Error('boom'))
    expect(await post()).toEqual({ status: 502, body: { error: 'boom' } })
    spy.mockRestore()
  })

  it('needs the settings permission and the provider tenant', async () => {
    checkPermissionMock.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    expect((await post()).status).toBe(403)
    tenantMock.mockResolvedValueOnce('tenant-a')
    expect((await post()).status).toBe(403)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })
})
