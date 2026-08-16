import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson, deniedPermissionResponse } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<Response | null>>(),
  getRequestGuestScopePerimeter: vi.fn<(...args: any[]) => Promise<any>>(),
  PERMISSIONS: {
    CONNECTION_VIEW: 'connection.view',
  },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

import { GET } from './route'
import { checkPermission, getRequestGuestScopePerimeter } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'

const checkPermissionMock = checkPermission as any
const getRequestGuestScopePerimeterMock = getRequestGuestScopePerimeter as any
const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getRequestGuestScopePerimeterMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue({ id: 'c1' })
  pveFetchMock.mockResolvedValue([
    { poolid: 'p1', comment: 'first pool' },
    { poolid: 'p2', comment: null },
  ])
})

describe('GET /api/v1/connections/[id]/pools', () => {
  it('returns the full pool list to a connection-scoped caller', async () => {
    const res = await callRoute(GET as any, { method: 'GET', params: { id: 'c1' } })
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(body.data.map((p: any) => p.poolid)).toEqual(['p1', 'p2'])
    expect(body.restricted).toBe(false)
    // No fallback needed, so the perimeter is never resolved.
    expect(getRequestGuestScopePerimeterMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/connections/[id]/pools: flat-scoped fallback', () => {
  it('lets a flat-scoped caller through and narrows the list to their pools', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())
    getRequestGuestScopePerimeterMock.mockResolvedValue({
      restricted: true,
      holdsPermission: true,
      hasVisibleGuests: true,
      pools: new Set(['p1']),
      nodes: new Set(['n1']),
    })

    const res = await callRoute(GET as any, { method: 'GET', params: { id: 'c1' } })
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(body.data).toEqual([{ poolid: 'p1', comment: 'first pool' }])
    expect(body.restricted).toBe(true)
  })

  it('keeps the 403 when the caller owns no visible guest on this connection', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())
    getRequestGuestScopePerimeterMock.mockResolvedValue({
      restricted: true,
      holdsPermission: true,
      hasVisibleGuests: false,
      pools: new Set(['p1']),
      nodes: new Set<string>(),
    })

    const res = await callRoute(GET as any, { method: 'GET', params: { id: 'c1' } })
    const body = await readJson<any>(res)

    expect(res.status).toBe(403)
    expect(body.error).toBe('Permission denied')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('keeps the 403 when the caller holds the permission nowhere', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())
    getRequestGuestScopePerimeterMock.mockResolvedValue({
      restricted: true,
      holdsPermission: false,
      hasVisibleGuests: true,
      pools: new Set(['p1']),
      nodes: new Set(['n1']),
    })

    const res = await callRoute(GET as any, { method: 'GET', params: { id: 'c1' } })
    const body = await readJson<any>(res)

    expect(res.status).toBe(403)
    expect(body.error).toBe('Permission denied')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('keeps the 403 when there is no perimeter at all (token or anonymous caller)', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())
    getRequestGuestScopePerimeterMock.mockResolvedValue(null)

    const res = await callRoute(GET as any, { method: 'GET', params: { id: 'c1' } })
    const body = await readJson<any>(res)

    expect(res.status).toBe(403)
    expect(body.error).toBe('Permission denied')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})
