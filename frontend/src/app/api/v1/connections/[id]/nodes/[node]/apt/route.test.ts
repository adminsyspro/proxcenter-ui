import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  buildNodeResourceId: (connId: string, node: string) => `${connId}:${node}`,
  PERMISSIONS: { NODE_VIEW: 'node.view', NODE_MANAGE: 'node.manage' },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: getConnectionByIdMock,
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: pveFetchMock,
}))

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({
    baseUrl: 'https://10.0.0.1:8006',
    apiToken: 'tok=secret',
  })
  pveFetchMock.mockReset()
})

async function importGET() {
  const mod = await import('./route')
  return mod.GET as Parameters<typeof callRoute>[0]
}

async function importPOST() {
  const mod = await import('./route')
  return mod.POST as Parameters<typeof callRoute>[0]
}

describe('GET /api/v1/connections/[id]/nodes/[node]/apt', () => {
  it('returns formatted updates and parsed nodeVersion when both calls succeed', async () => {
    pveFetchMock
      .mockResolvedValueOnce([
        { Package: 'pve-manager', OldVersion: '9.1.1', Version: '9.1.9' },
        { Package: 'qemu-server', OldVersion: '8.0.0', Version: '8.1.0' },
      ])
      .mockResolvedValueOnce({ pveversion: 'pve-manager/9.1.1/2a5fa54a8503f96d' })

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1', node: 'pve1' } })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.count).toBe(2)
    expect(body.nodeVersion).toBe('9.1.1')
    expect(body.data[0]).toEqual({
      package: 'pve-manager',
      title: null,
      description: null,
      currentVersion: '9.1.1',
      newVersion: '9.1.9',
      origin: null,
      priority: null,
      section: null,
    })
  })

  it('returns updates even when the /status call rejects (nodeVersion null)', async () => {
    pveFetchMock
      .mockResolvedValueOnce([{ Package: 'pve-manager', OldVersion: '9.1.1', Version: '9.1.9' }])
      .mockRejectedValueOnce(new Error('PVE 500 status timeout'))

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1', node: 'pve1' } })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.count).toBe(1)
    expect(body.nodeVersion).toBeNull()
  })

  it('returns needsRefresh=true and exposes nodeVersion when apt update has never run (596)', async () => {
    pveFetchMock
      .mockRejectedValueOnce(new Error('PVE 596 no package list — apt update first'))
      .mockResolvedValueOnce({ pveversion: 'pve-manager/9.1.1/abc' })

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1', node: 'pve1' } })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body).toMatchObject({
      data: [],
      count: 0,
      needsRefresh: true,
      nodeVersion: '9.1.1',
    })
  })

  it('returns permissionError=Sys.Modify when the apt GET is denied by RBAC on PVE side', async () => {
    pveFetchMock
      .mockRejectedValueOnce(new Error('PVE 403 Permission check failed'))
      .mockResolvedValueOnce({ pveversion: 'pve-manager/9.1.1/abc' })

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1', node: 'pve1' } })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body).toMatchObject({
      data: [],
      count: 0,
      permissionError: 'Sys.Modify',
      nodeVersion: '9.1.1',
    })
  })

  it('returns 500 for unrelated apt failures', async () => {
    pveFetchMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ pveversion: 'pve-manager/9.1.1/abc' })

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1', node: 'pve1' } })

    expect(res.status).toBe(500)
  })

  it('returns the denied Response when RBAC rejects the caller', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValueOnce(denied as any)

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1', node: 'pve1' } })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('keeps raw pveversion when it does not contain a slash', async () => {
    pveFetchMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ pveversion: '9.1.1' })

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1', node: 'pve1' } })

    const body = await readJson<any>(res)
    expect(body.nodeVersion).toBe('9.1.1')
  })
})

describe('POST /api/v1/connections/[id]/nodes/[node]/apt', () => {
  it('returns 403 with requiredPermission=Sys.Modify when PVE rejects the refresh', async () => {
    pveFetchMock.mockRejectedValueOnce(new Error('PVE 403 Sys.Modify required'))

    const POST = await importPOST()
    const res = await callRoute(POST, { params: { id: 'c1', node: 'pve1' }, body: {} })

    expect(res.status).toBe(403)
    const body = await readJson<any>(res)
    expect(body).toMatchObject({
      error: 'permissionDenied',
      requiredPermission: 'Sys.Modify',
    })
  })
})
