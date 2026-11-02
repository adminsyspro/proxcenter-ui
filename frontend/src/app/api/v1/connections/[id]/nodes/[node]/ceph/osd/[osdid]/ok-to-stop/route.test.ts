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
  PERMISSIONS: { STORAGE_ADMIN: 'storage.admin' },
}))
vi.mock('@/lib/ssh/exec', () => ({
  executeSSH: vi.fn(async () => {
    throw new Error('executeSSH must not be called by the OSD precheck')
  }),
}))

import { POST } from './route'
import { pveFetch } from '@/lib/proxmox/client'
import { checkPermission } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { executeSSH } from '@/lib/ssh/exec'

const pveFetchMock = pveFetch as any
const checkPermissionMock = checkPermission as any
const executeSSHMock = executeSSH as any
const params = { id: 'c1', node: 'pve1', osdid: '3' }
const post = (p: Record<string, string> = params) => callRoute(POST, { params: p, method: 'POST', body: {} })

const CLUSTER_STATUS = [{ type: 'node', name: 'pve1', online: 1 }]
const SAFE_URL = '/nodes/pve1/ceph/cmd-safety?service=osd&id=3&action=stop'
const answer = (safety: any) => async (_c: any, path: string) => {
  if (path === '/cluster/status') return CLUSTER_STATUS
  if (path === SAFE_URL) {
    if (safety instanceof Error) throw safety
    return safety
  }
  throw new Error(`unexpected PVE path ${path}`)
}
const pveCalls = () => pveFetchMock.mock.calls.map((c: any[]) => c[1])

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  pveFetchMock.mockImplementation(answer({ safe: true }))
})

describe('POST .../ceph/osd/[osdid]/ok-to-stop', () => {
  it('answers the verdict of PVE cmd-safety, with /cluster/status as the only other PVE call, no SSH', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { ok: true, osds: [3], numOkPgs: 0, numNotOkPgs: 0, message: null } })
    expect(pveCalls()).toEqual(['/cluster/status', SAFE_URL])
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('a refusal answers ok:false with the number of PGs and no ratios', async () => {
    pveFetchMock.mockImplementation(answer({ safe: false, status: 'unsafe to stop osd(s) at this time (12 PGs are or would become offline)' }))
    const body = await readJson<any>(await post())

    expect(body).toEqual({ data: { ok: false, osds: [3], numOkPgs: 0, numNotOkPgs: 12, message: null } })
    expect(body.data).not.toHaveProperty('ratios')
  })

  it('asks the online node picked by pickOnlineNode when the host is down', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/cluster/status') return [{ type: 'node', name: 'pve1', online: 0 }, { type: 'node', name: 'pve2', online: 1 }]
      return { safe: true }
    })
    await post()

    expect(pveCalls()).toEqual(['/cluster/status', '/nodes/pve2/ceph/cmd-safety?service=osd&id=3&action=stop'])
  })

  it('an unreadable /cluster/status answers an unknown verdict, nothing asked', async () => {
    pveFetchMock.mockRejectedValue(new Error('pve down'))
    const res = await post()

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toMatchObject({ data: { ok: false, osds: [3], message: expect.any(String) } })
    expect(pveCalls()).toEqual(['/cluster/status'])
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('a PVE without the route (501) answers ok:false with a fixed message, never a safe verdict', async () => {
    pveFetchMock.mockImplementation(answer(new Error('PVE 501 /nodes/pve1/ceph/cmd-safety: Method not implemented')))
    const res = await post()

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toMatchObject({ data: { ok: false, osds: [3], message: 'Ceph could not be asked whether stopping is safe' } })
  })

  it('an answer without safe is an unknown verdict', async () => {
    pveFetchMock.mockImplementation(answer({}))

    expect(await readJson<any>(await post())).toMatchObject({ data: { ok: false, message: 'Ceph could not be asked whether stopping is safe' } })
  })

  it('an error naming the node and address never reaches the payload, the log gets it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    pveFetchMock.mockImplementation(answer(new Error('connect pve1 10.42.0.101: connection refused')))
    const res = await post()
    expect(res.status).toBe(200)
    const raw = JSON.stringify(await readJson<any>(res))
    expect(raw).not.toContain('pve1')
    expect(raw).not.toContain('10.42.0.101')
    expect(spy.mock.calls.flat().join(' ')).toContain('10.42.0.101')
    spy.mockRestore()
  })

  it('the status text of PVE never reaches the payload', async () => {
    pveFetchMock.mockImplementation(answer({ safe: false, status: 'OSD(s) 3 on pve1 10.42.0.101 have 129 PGs currently mapped to them. ' }))
    const raw = JSON.stringify(await readJson<any>(await post()))

    expect(raw).toContain('129')
    expect(raw).not.toContain('pve1')
    expect(raw).not.toContain('10.42.0.101')
    expect(raw).not.toContain('mapped')
  })

  it('500: the response carries neither the node nor the address, the log does', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(getConnectionById as any).mockRejectedValueOnce(new Error('db pve1 10.42.0.101'))
    const res = await post()
    expect(res.status).toBe(500)
    const raw = JSON.stringify(await readJson<any>(res))
    expect(raw).not.toContain('pve1')
    expect(raw).not.toContain('10.42.0.101')
    expect(String(spy.mock.calls.flat().join(' '))).toContain('10.42.0.101')
    spy.mockRestore()
  })

  it('404 when the node is not a member of the connection, no SSH', async () => {
    const res = await post({ ...params, node: 'other' })
    expect(res.status).toBe(404)
    expect(executeSSHMock).not.toHaveBeenCalled()
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
  })

  it('400 on a bad osd id or node, 403 without storage.admin', async () => {
    expect((await post({ ...params, osdid: '1a' })).status).toBe(400)
    expect((await post({ ...params, node: '../x' })).status).toBe(400)
    checkPermissionMock.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    expect((await post()).status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('answers 500 with a generic message when the connection cannot be loaded', async () => {
    (getConnectionById as any).mockRejectedValueOnce(new Error('db down'))
    const res = await post()

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Failed to check the OSD' })
    expect(executeSSHMock).not.toHaveBeenCalled()
  })
})
