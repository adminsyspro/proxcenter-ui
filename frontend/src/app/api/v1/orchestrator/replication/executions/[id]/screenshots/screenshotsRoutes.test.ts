import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const checkPermission = vi.fn()
const getExecution = vi.fn()
const getRecoveryPlan = vi.fn()
const getExecutionScreenshots = vi.fn()
const getTenantConnectionIds = vi.fn()

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...args: unknown[]) => checkPermission(...args),
  PERMISSIONS: { AUTOMATION_VIEW: 'automation.view' },
}))
vi.mock('@/lib/tenant', () => ({
  getTenantConnectionIds: () => getTenantConnectionIds(),
}))
vi.mock('@/lib/orchestrator/client', () => ({
  getOrchestratorClient: () => ({ getExecution, getRecoveryPlan, getExecutionScreenshots }),
}))

import { GET as listScreenshots } from './route'
import { GET as getScreenshotPng } from './[vmid]/route'

beforeEach(() => {
  checkPermission.mockResolvedValue(null)
  getTenantConnectionIds.mockResolvedValue(new Set(['conn-src', 'conn-dst']))
  getExecution.mockResolvedValue({ data: { id: 'exec-1', plan_id: 'plan-1' } })
  getRecoveryPlan.mockResolvedValue({ data: { source_cluster: 'conn-src', target_cluster: 'conn-dst' } })
  getExecutionScreenshots.mockResolvedValue({ data: [{ vm_id: 100, target_vmid: 9100, captured_at: '2026-08-10T20:00:00Z' }] })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('GET /replication/executions/[id]/screenshots', () => {
  it('returns the metadata list for an in-tenant execution', async () => {
    const res = await callRoute(listScreenshots, { params: { id: 'exec-1' } })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ vm_id: 100, target_vmid: 9100, captured_at: '2026-08-10T20:00:00Z' }])
  })

  it('404s when the plan belongs to another tenant', async () => {
    getRecoveryPlan.mockResolvedValue({ data: { source_cluster: 'foreign', target_cluster: 'conn-dst' } })

    const res = await callRoute(listScreenshots, { params: { id: 'exec-1' } })

    expect(res.status).toBe(404)
    expect(getExecutionScreenshots).not.toHaveBeenCalled()
  })
})

describe('GET /replication/executions/[id]/screenshots/[vmid]', () => {
  it('passes the PNG through with image headers', async () => {
    const png = new Uint8Array([137, 80, 78, 71])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(png, { status: 200 })))

    const res = await callRoute(getScreenshotPng, { params: { id: 'exec-1', vmid: '100' } })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe('private, max-age=86400')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png)
  })

  it('rejects a non-numeric vmid before any upstream call', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const res = await callRoute(getScreenshotPng, { params: { id: 'exec-1', vmid: 'abc' } })

    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('maps an upstream miss to 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })))

    const res = await callRoute(getScreenshotPng, { params: { id: 'exec-1', vmid: '100' } })

    expect(res.status).toBe(404)
  })
})
