import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

// Provider or MSP tenant: the IaaS Ceph gate lets the caller through (its own tests: lib/ceph/tenantGuard*.test.ts).
vi.mock('@/lib/ceph/tenantGuard', () => ({ denyIaasTenantCeph: async () => null }))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
  isConnectionNotFoundError: (err: unknown) =>
    /connection not found/i.test((err as { message?: string } | null)?.message || ''),
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn<(...a: any[]) => Promise<any>>() }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...a: any[]) => Promise<any>>(),
  PERMISSIONS: { STORAGE_ADMIN: 'storage.admin' },
}))
vi.mock('@/lib/ssh/exec', () => ({
  executeSSH: vi.fn(async () => {
    throw new Error('executeSSH must not be called by the OSD routes')
  }),
}))

const auditMock = vi.fn<(...a: any[]) => Promise<void>>()
vi.mock('@/lib/audit', async () => {
  // audit() flips the request's audit scope so withAudit() adds no row of its own.
  const { markAuditExplicit } = await vi.importActual<typeof import('@/lib/audit/scope')>('@/lib/audit/scope')
  return { audit: (...a: any[]) => { markAuditExplicit(); return auditMock(...a) } }
})

import { POST } from './route'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { checkPermission } from '@/lib/rbac'
import { executeSSH } from '@/lib/ssh/exec'

const pveFetchMock = pveFetch as any
const checkPermissionMock = checkPermission as any
const executeSSHMock = executeSSH as any

const UPID = 'UPID:pve1:0001A2B3:00C4D5E6:68F7A8B9:cephscrub:3:root@pam:'
const SAFE_URL = '/nodes/pve1/ceph/cmd-safety?service=osd&id=3&action=stop'
const NOT_OK = { safe: false, status: 'unsafe to stop osd(s) at this time (33 PGs are or would become offline)' }
const CLUSTER_STATUS = [{ type: 'node', name: 'pve1', online: 1 }]

const params = { id: 'c1', node: 'pve1', osdid: '3' }
const pveCalls = () => pveFetchMock.mock.calls.map((c: any[]) => [c[1], c[2]?.method ?? 'GET', c[2]?.body?.toString()])
const post = (body: Record<string, unknown>, p: Record<string, string> = params) =>
  callRoute(POST, { params: p, method: 'POST', body })
const mutations = () => pveCalls().filter(([, m]: any[]) => m === 'POST')

let safety: any = { safe: true }

beforeEach(() => {
  vi.clearAllMocks()
  safety = { safe: true }
  checkPermissionMock.mockResolvedValue(null)
  ;(getConnectionById as any).mockResolvedValue({ id: 'c1' })
  auditMock.mockResolvedValue(undefined)
  pveFetchMock.mockImplementation(async (_c: any, path: string) => {
    if (path === '/nodes') return [{ node: 'pve1' }, { node: 'pve2' }]
    if (path === '/cluster/status') return CLUSTER_STATUS
    if (path === SAFE_URL) return safety
    if (/\/ceph\/osd\/\d+\/(in|out|scrub)$/.test(path)) return UPID
    throw new Error(`unexpected PVE path ${path}`)
  })
})

describe('POST /api/v1/connections/[id]/nodes/[node]/ceph/osd/[osdid]', () => {
  it('400 on a bad osd id, a bad node name or an unknown action, before any PVE call', async () => {
    expect((await post({ action: 'in' }, { ...params, osdid: '1a' })).status).toBe(400)
    expect((await post({ action: 'in' }, { ...params, node: '../x' })).status).toBe(400)
    expect((await post({ action: 'reboot' })).status).toBe(400)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('404 when the node is not part of the connection, nothing posted', async () => {
    expect((await post({ action: 'in' }, { ...params, node: 'other' })).status).toBe(404)
    expect(mutations()).toEqual([])
  })

  it('403 without storage.admin, no PVE call', async () => {
    checkPermissionMock.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    expect((await post({ action: 'in' })).status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
    expect(checkPermissionMock).toHaveBeenCalledWith('storage.admin', 'connection', 'c1')
  })

  it('in posts to .../osd/3/in without a precheck', async () => {
    const res = await post({ action: 'in' })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { upid: UPID, node: 'pve1', osd: 3, action: 'in' } })
    expect(mutations()).toEqual([['/nodes/pve1/ceph/osd/3/in', 'POST', undefined]])
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('scrub posts without a body, deep-scrub posts deep=1 to the scrub path', async () => {
    await post({ action: 'scrub' })
    await post({ action: 'deep-scrub' })
    expect(mutations()).toEqual([
      ['/nodes/pve1/ceph/osd/3/scrub', 'POST', undefined],
      ['/nodes/pve1/ceph/osd/3/scrub', 'POST', 'deep=1'],
    ])
  })

  it('out with a refused ok-to-stop is 409 and posts nothing', async () => {
    safety = NOT_OK
    const res = await post({ action: 'out' })
    expect(res.status).toBe(409)
    expect(await readJson<any>(res)).toMatchObject({ code: 'not_ok_to_stop', okToStop: { ok: false, numNotOkPgs: 33 } })
    expect(mutations()).toEqual([])
  })

  it('out with a safe verdict posts to .../out', async () => {
    expect((await post({ action: 'out' })).status).toBe(200)
    expect(pveCalls().map(([p]: any[]) => p)).toEqual(['/nodes', '/cluster/status', SAFE_URL, '/nodes/pve1/ceph/osd/3/out'])
    expect(mutations()).toEqual([['/nodes/pve1/ceph/osd/3/out', 'POST', undefined]])
  })

  it('out with force skips the precheck', async () => {
    expect((await post({ action: 'out', force: true })).status).toBe(200)
    expect(pveCalls().map(([p]: any[]) => p)).not.toContain(SAFE_URL)
    expect(executeSSHMock).not.toHaveBeenCalled()
    expect(mutations()).toEqual([['/nodes/pve1/ceph/osd/3/out', 'POST', undefined]])
  })

  it('the audit row is ceph_osd with the verb ceph_osd_out in its details', async () => {
    await post({ action: 'out', force: true })
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toMatchObject({
      action: 'ceph_osd',
      category: 'nodes',
      resourceId: 'pve1',
      details: { detail: 'ceph_osd_out', osd: 3, forced: true },
    })
    await post({ action: 'deep-scrub' })
    expect(auditMock.mock.calls[1][0].details.detail).toBe('ceph_osd_deep_scrub')
  })

  it('a refused out leaves one failure row with the verb and the verdict', async () => {
    safety = NOT_OK
    await post({ action: 'out' })
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toMatchObject({
      action: 'ceph_osd',
      status: 'failure',
      details: { detail: 'ceph_osd_out', osd: 3, okToStop: { ok: false, numNotOkPgs: 33 } },
    })
  })

  it('forced is recorded only for out', async () => {
    await post({ action: 'scrub', force: true })
    expect(auditMock.mock.calls[0][0].details.forced).toBe(false)
  })

  it('500: the response carries neither the node nor the address, the log does', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/cluster/status') return CLUSTER_STATUS
      throw new Error('PVE 500 /nodes/pve1/ceph/crush: connect to 10.42.0.101 failed')
    })
    const res = await post({ action: 'in' })
    expect(res.status).toBe(500)
    const raw = JSON.stringify(await readJson<any>(res))
    expect(raw).not.toContain('pve1')
    expect(raw).not.toContain('10.42.0.101')
    expect(String(spy.mock.calls.flat().join(' '))).toContain('10.42.0.101')
    spy.mockRestore()
  })

  it('409 on an out whose PVE check fails: no node nor address in the body, the log gets them', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/nodes') return [{ node: 'pve1' }]
      if (path === '/cluster/status') return CLUSTER_STATUS
      throw new Error('PVE 500 /nodes/pve1/ceph/cmd-safety: connect to 10.42.0.101 failed')
    })
    const res = await post({ action: 'out' })
    expect(res.status).toBe(409)
    const body = await readJson<any>(res)
    expect(body.code).toBe('not_ok_to_stop')
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('pve1')
    expect(raw).not.toContain('10.42.0.101')
    expect(spy.mock.calls.flat().join(' ')).toContain('10.42.0.101')
    expect(mutations()).toEqual([])
    spy.mockRestore()
  })

  it('409 on an out when the answer has no safe field, never a safe default', async () => {
    safety = {}
    const res = await post({ action: 'out' })
    expect(res.status).toBe(409)
    expect(await readJson<any>(res)).toMatchObject({ code: 'not_ok_to_stop', okToStop: { ok: false } })
    expect(mutations()).toEqual([])
  })

  it('no route of the OSD action ever opens an SSH session', async () => {
    await post({ action: 'out' })
    await post({ action: 'out', force: true })
    safety = NOT_OK
    await post({ action: 'out' })
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('a lost audit row does not turn a done action into a 500', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    auditMock.mockRejectedValueOnce(new Error('db down'))
    const res = await post({ action: 'in' })
    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
