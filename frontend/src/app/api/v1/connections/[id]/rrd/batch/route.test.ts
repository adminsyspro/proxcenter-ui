import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const getRBACContextMock = vi.fn<() => Promise<any>>()
const hasPermissionMock = vi.fn<(check: any) => Promise<boolean>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  getRBACContext: getRBACContextMock,
  hasPermission: hasPermissionMock,
  PERMISSIONS: { VM_VIEW: 'vm.view', NODE_VIEW: 'node.view' },
  buildVmResourceId: (c: string, n: string, t: string, v: string) => `${c}:${n}:${t}:${v}`,
  buildNodeResourceId: (c: string, n: string) => `${c}:${n}`,
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: getConnectionByIdMock,
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: pveFetchMock,
}))

// Dynamic import so the route (and its mocked deps) loads after the mock
// consts above are initialized — the repo convention for route tests.
const importPOST = async () => (await import('./route')).POST

beforeEach(() => {
  vi.clearAllMocks()
  getRBACContextMock.mockResolvedValue({ userId: 'u1', isAdmin: false, tenantId: 'default' })
  getConnectionByIdMock.mockResolvedValue({ id: 'conn1' })
  pveFetchMock.mockImplementation(async (_conn: any, rrdPath: string) => [{ path: rrdPath }])
})

describe('POST /api/v1/connections/:id/rrd/batch', () => {
  it('401s when unauthenticated', async () => {
    getRBACContextMock.mockResolvedValue(null)

    const res = await callRoute(await importPOST(), {
      params: { id: 'conn1' },
      body: { paths: ['/nodes/pve1'], timeframe: 'hour' },
    })

    expect(res.status).toBe(401)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('drops paths the caller cannot see and only fetches the allowed ones', async () => {
    // pve1 allowed, pve2 denied.
    hasPermissionMock.mockImplementation(async (check) => check.resourceId === 'conn1:pve1')

    const res = await callRoute(await importPOST(), {
      params: { id: 'conn1' },
      body: { paths: ['/nodes/pve1', '/nodes/pve2'], timeframe: 'hour' },
    })

    expect(res.status).toBe(200)
    // Each node path checked against node.view on its node resource.
    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ permission: 'node.view', resourceType: 'node', resourceId: 'conn1:pve1' }),
    )
    const json = await readJson<{ data: Record<string, unknown> }>(res)
    expect(Object.keys(json!.data)).toEqual(['/nodes/pve1'])
    // Only the allowed node was fetched.
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns an empty map when no path is allowed', async () => {
    hasPermissionMock.mockResolvedValue(false)

    const res = await callRoute(await importPOST(), {
      params: { id: 'conn1' },
      body: { paths: ['/nodes/pve1', '/nodes/pve2'], timeframe: 'hour' },
    })

    expect(res.status).toBe(200)
    const json = await readJson<{ data: Record<string, unknown> }>(res)
    expect(json?.data).toEqual({})
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})
