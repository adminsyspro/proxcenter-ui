import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const { requireFeatureMock, checkPermissionMock, cookieMock, forecastMock, planMock } = vi.hoisted(() => ({
  requireFeatureMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  cookieMock: vi.fn(),
  forecastMock: vi.fn(),
  planMock: vi.fn(),
}))

vi.mock('@/lib/auth/requireEnterprise', () => ({ requireFeature: (...a: unknown[]) => requireFeatureMock(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view' },
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => cookieMock(name) }) }))
vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({ prisma: true }),
  getCurrentTenantId: async () => 'tenant-1',
}))
vi.mock('./forecastInsightsService', () => ({ getForecastInsights: (...a: unknown[]) => forecastMock(...a) }))
vi.mock('./optimizationPlanService', () => ({ getOptimizationPlan: (...a: unknown[]) => planMock(...a) }))

import { readingRoute, type ReadingRequest } from './readingRoute'
import { GET as forecastGET } from '@/app/api/v1/resources/forecast-insights/route'
import { GET as planGET } from '@/app/api/v1/resources/optimization-plan/route'

const get = (query = '') => new Request(`http://test.local/api/v1/resources/x${query}`)

beforeEach(() => {
  requireFeatureMock.mockReset().mockResolvedValue(null)
  checkPermissionMock.mockReset().mockResolvedValue(null)
  cookieMock.mockReset().mockReturnValue({ value: 'fr' })
  forecastMock.mockReset()
  planMock.mockReset()
})

describe('readingRoute', () => {
  it('passes the scope, the UI locale and the refresh flag to the loader', async () => {
    const load = vi.fn(async (_r: ReadingRequest) => ({ summary: 'ok' }))
    const response = await readingRoute('test', load)(get('?connectionId=c1&refresh=1'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: { summary: 'ok' } })
    expect(load.mock.calls[0][0]).toMatchObject({
      tenantId: 'tenant-1',
      filterConnectionId: 'c1',
      locale: 'fr',
      scopeAll: 'all clusters',
      refresh: true,
    })
  })

  it('reads the whole estate without a connection and does not refresh by default', async () => {
    const load = vi.fn(async (_r: ReadingRequest) => ({}))
    await readingRoute('test', load)(get())

    expect(load.mock.calls[0][0]).toMatchObject({ filterConnectionId: undefined, refresh: false })
  })

  it('answers 404 when the connection is not one of the tenant', async () => {
    const response = await readingRoute('test', async () => null)(get('?connectionId=other'))

    expect(response.status).toBe(404)
  })

  it('stops at the feature gate, then at the permission', async () => {
    const load = vi.fn()
    requireFeatureMock.mockResolvedValueOnce(NextResponse.json({ error: 'feature' }, { status: 403 }))
    expect((await readingRoute('test', load)(get())).status).toBe(403)

    checkPermissionMock.mockResolvedValueOnce(NextResponse.json({ error: 'rbac' }, { status: 403 }))
    expect((await readingRoute('test', load)(get())).status).toBe(403)
    expect(load).not.toHaveBeenCalled()
  })

  it('answers 500 without leaking the error', async () => {
    const response = await readingRoute('test', async () => { throw new Error('secret detail') })(get())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' })
  })
})

describe('reading routes', () => {
  it('serve the forecast reading and the optimisation plan', async () => {
    forecastMock.mockResolvedValue({ kind: 'forecast' })
    planMock.mockResolvedValue({ kind: 'plan' })

    await expect((await forecastGET(get())).json()).resolves.toEqual({ data: { kind: 'forecast' } })
    await expect((await planGET(get())).json()).resolves.toEqual({ data: { kind: 'plan' } })
  })
})
