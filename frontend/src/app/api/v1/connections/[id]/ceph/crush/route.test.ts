import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

const pveFetchMock = pveFetch as any
const checkPermissionMock = checkPermission as any
const CRUSH = readFileSync(resolve(process.cwd(), 'src/lib/ceph/__fixtures__/crushmap-3hosts.txt'), 'utf8')
const get = () => callRoute(GET, { params: { id: 'c1' }, method: 'GET' })

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  pveFetchMock.mockImplementation(async (_c: any, path: string) => {
    if (path === '/cluster/status') {
      return [
        { type: 'node', name: 'pve1', online: 0 },
        { type: 'node', name: 'pve2', online: 1 },
      ]
    }
    if (path === '/nodes/pve2/ceph/crush') return CRUSH
    throw new Error(`unexpected ${path}`)
  })
})

describe('GET /api/v1/connections/[id]/ceph/crush', () => {
  it('parses the map read from an online node (2 PVE calls)', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    const { data } = await readJson<any>(res)
    expect(data.buckets.length).toBeGreaterThan(0)
    expect(data.rules.length).toBeGreaterThan(0)
    expect(data.types).toContain('host')
    expect(pveFetchMock.mock.calls.map((c: any[]) => c[1])).toEqual(['/cluster/status', '/nodes/pve2/ceph/crush'])
  })

  it('404 hasCeph:false when the cluster has no Ceph', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/cluster/status') return [{ type: 'node', name: 'pve1', online: 1 }]
      throw new Error('PVE 500 /nodes/pve1/ceph/crush: pveceph configuration not initialized')
    })
    const res = await get()
    expect(res.status).toBe(404)
    expect(await readJson<any>(res)).toMatchObject({ hasCeph: false })
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

  it('404 when no node is online', async () => {
    pveFetchMock.mockImplementation(async () => [{ type: 'node', name: 'pve1', online: 0 }])
    expect((await get()).status).toBe(404)
  })

  it('403 when the permission is refused, with no PVE call', async () => {
    checkPermissionMock.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    expect((await get()).status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})
