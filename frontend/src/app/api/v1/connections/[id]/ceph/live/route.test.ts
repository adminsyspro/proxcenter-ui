import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

// Provider or MSP tenant: the IaaS Ceph gate lets the caller through (its own tests: lib/ceph/tenantGuard*.test.ts).
vi.mock('@/lib/ceph/tenantGuard', () => ({ denyIaasTenantCeph: async () => null }))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn(async () => ({ id: 'c1' })),
  isConnectionNotFoundError: () => false,
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn<(...a: any[]) => Promise<any>>() }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...a: any[]) => Promise<any>>(),
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view' },
}))

import { GET } from './route'
import { pveFetch } from '@/lib/proxmox/client'
import { checkPermission } from '@/lib/rbac'
import statusLab from '@/lib/ceph/__fixtures__/status-lab-ceph20.json'

const pveFetchMock = pveFetch as any
const checkPermissionMock = checkPermission as any
const get = () => callRoute(GET, { params: { id: 'c1' }, method: 'GET' })

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
})

describe('GET /api/v1/connections/[id]/ceph/live', () => {
  it('makes one PVE call to /cluster/ceph/status and answers the reduced CephLive', async () => {
    pveFetchMock.mockResolvedValue(statusLab)
    const res = await get()
    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
    expect(pveFetchMock.mock.calls[0][1]).toBe('/cluster/ceph/status')
    expect(checkPermissionMock).toHaveBeenCalledWith('connection.view', 'connection', 'c1')
    const body = await readJson<any>(res)
    expect(Object.keys(body.data).sort()).toEqual(['at', 'health', 'io', 'osd', 'pg', 'raw', 'recovery'])
  })

  it('never forwards the raw status: no mgrmap, a small payload', async () => {
    const raw = { ...(statusLab as any), mgrmap: { blob: 'x'.repeat(200_000) } }
    pveFetchMock.mockResolvedValue(raw)
    const res = await get()
    const text = JSON.stringify(await readJson<any>(res))
    expect(text).not.toContain('mgrmap')
    expect(text).not.toContain('xxxxxxxx')
    expect(text.length).toBeLessThan(20_000)
  })

  it('403 when the permission is refused, with no PVE call', async () => {
    checkPermissionMock.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    expect((await get()).status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('404 hasCeph:false when Ceph is not installed (501)', async () => {
    pveFetchMock.mockRejectedValue(Object.assign(new Error('PVE 501 /cluster/ceph/status: Method not implemented'), { statusCode: 501 }))
    const res = await get()
    expect(res.status).toBe(404)
    expect(await readJson<any>(res)).toMatchObject({ hasCeph: false })
  })

  it('404 hasCeph:false on the real PVE message of a cluster without pveceph init, or a statusCode 501', async () => {
    pveFetchMock.mockRejectedValueOnce(new Error('PVE 500 /cluster/ceph/status: pveceph configuration not initialized'))
    let res = await get()
    expect(res.status).toBe(404)
    expect(await readJson<any>(res)).toMatchObject({ hasCeph: false })
    pveFetchMock.mockRejectedValueOnce(Object.assign(new Error('nope'), { statusCode: 501 }))
    res = await get()
    expect(res.status).toBe(404)
  })

  it('500 on any other PVE error, generic message', async () => {
    pveFetchMock.mockRejectedValue(new Error('PVE 500 /cluster/ceph/status: boom'))
    const res = await get()
    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Failed to read the Ceph status' })
  })

  it('500: the response carries neither the node nor the address, the log does', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    pveFetchMock.mockRejectedValue(new Error('PVE 500 /nodes/pve1/ceph/crush: connect to 10.42.0.101 failed'))
    const res = await get()
    expect(res.status).toBe(500)
    const raw = JSON.stringify(await readJson<any>(res))
    expect(raw).not.toContain('pve1')
    expect(raw).not.toContain('10.42.0.101')
    expect(String(spy.mock.calls.flat().join(' '))).toContain('10.42.0.101')
    spy.mockRestore()
  })
})
