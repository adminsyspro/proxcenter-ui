import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const { requireProviderAdminMock, orchestratorFetchMock } = vi.hoisted(() => ({
  requireProviderAdminMock: vi.fn(),
  orchestratorFetchMock: vi.fn(),
}))

vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: () => null }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))
// Provider tenant + admin.settings in one guard, judged on the principal's own
// tenant rather than getCurrentTenantId() and its fallback to `default`.
vi.mock('@/lib/tenant/providerGuard', () => ({ requireProviderAdmin: (...a: any[]) => requireProviderAdminMock(...a) }))
vi.mock('@/lib/orchestrator/client', () => ({ orchestratorFetch: (...a: any[]) => orchestratorFetchMock(...a) }))

import { POST } from './route'

const originalUrl = process.env.ORCHESTRATOR_URL

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderAdminMock.mockResolvedValue(null)
  orchestratorFetchMock.mockResolvedValue({ started: true })
  process.env.ORCHESTRATOR_URL = 'http://orchestrator.test'
})

afterEach(() => {
  process.env.ORCHESTRATOR_URL = originalUrl
})

async function post() {
  const res = await callRoute(POST as any, { method: 'POST' })
  return { status: res.status, body: await res.json() }
}

describe('POST /api/v1/orchestrator/alerts/backup-coverage/check (roadmap#48)', () => {
  it('relays the request to the orchestrator and answers 202', async () => {
    expect(await post()).toEqual({ status: 202, body: { started: true } })
    expect(orchestratorFetchMock).toHaveBeenCalledWith('/alerts/backup-coverage/check', { method: 'POST' })
  })

  it('reports a pass already running as started=false', async () => {
    orchestratorFetchMock.mockResolvedValueOnce({ started: false })
    expect((await post()).body).toEqual({ started: false })
  })

  it('does nothing without an orchestrator', async () => {
    delete process.env.ORCHESTRATOR_URL
    expect(await post()).toEqual({ status: 202, body: { started: false, reason: 'no_orchestrator' } })
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })

  it('answers 502 when the orchestrator cannot be reached', async () => {
    orchestratorFetchMock.mockRejectedValueOnce(Object.assign(new Error('down'), { code: 'ORCHESTRATOR_UNAVAILABLE' }))
    expect((await post()).status).toBe(502)
  })

  it('needs the settings permission and the provider tenant', async () => {
    requireProviderAdminMock.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    expect((await post()).status).toBe(403)
    expect(requireProviderAdminMock).toHaveBeenCalledWith('admin.settings')
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })
})
