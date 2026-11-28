import { describe, it, expect, vi, beforeEach } from 'vitest'

// The API token guard is covered by routeGuard.test.ts and writeContract.test.ts:
// pass-through so this file keeps testing the handler, as for a session caller.
// The vDC guest guard (lib/vdc/guestGuard.ts) has its own tests: pass-through
// here, as for a provider session.
vi.mock('@/lib/vdc/guestGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/vdc/guestGuard')>()),
  guardSessionGuest: async () => null,
  sessionIsVdcTenant: vi.fn<() => Promise<boolean>>(),
}))
vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/unreferencedDisks', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/proxmox/unreferencedDisks')>()),
  decideUnreferencedDiskPurge: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<any>>(),
  buildVmResourceId: vi.fn<(...args: any[]) => string>(
    (connId, node, type, vmid) => `${connId}:${node}:${type}:${vmid}`
  ),
  PERMISSIONS: {
    VM_DELETE: 'vm.delete',
    VM_VIEW: 'vm.view',
  },
}))

vi.mock('@/lib/vdc/ipam', () => ({
  releaseAllocationsForVm: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/audit', () => ({
  audit: vi.fn<(...args: any[]) => Promise<void>>(),
}))

import { DELETE } from './route'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { checkPermission } from '@/lib/rbac'
import { releaseAllocationsForVm } from '@/lib/vdc/ipam'
import { audit } from '@/lib/audit'
import { decideUnreferencedDiskPurge } from '@/lib/proxmox/unreferencedDisks'
import { sessionIsVdcTenant } from '@/lib/vdc/guestGuard'

const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any
const checkPermissionMock = checkPermission as any
const releaseAllocationsForVmMock = releaseAllocationsForVm as any
const auditMock = audit as any
const decideMock = decideUnreferencedDiskPurge as any
const vdcSessionMock = sessionIsVdcTenant as any

const CONN_ID = 'conn-1'
const NODE = 'pve-node-01'
const VMID = '101'

const baseParams = { id: CONN_ID, type: 'qemu', node: NODE, vmid: VMID }

function makeReq(url = `http://test.local/_`) {
  return new Request(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue({ id: CONN_ID })
  pveFetchMock.mockResolvedValue({ status: 'stopped' })
  releaseAllocationsForVmMock.mockResolvedValue(undefined)
  auditMock.mockResolvedValue(undefined)
  decideMock.mockResolvedValue({ destroyUnreferenced: true, keptVolumes: [] })
  vdcSessionMock.mockResolvedValue(false)
})

describe('DELETE /api/v1/connections/[id]/guests/[type]/[node]/[vmid]', () => {
  it('400 when type is not qemu or lxc', async () => {
    const res = await DELETE(makeReq(), {
      params: Promise.resolve({ ...baseParams, type: 'template' }),
    })
    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body.error).toMatch(/Invalid type/)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('403 when RBAC denies delete permission', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)
    const res = await DELETE(makeReq(), {
      params: Promise.resolve(baseParams),
    })
    expect(res.status).toBe(403)
  })

  it('409 when VM is locked', async () => {
    pveFetchMock.mockResolvedValueOnce({ status: 'stopped', lock: 'snapshot' })
    const res = await DELETE(makeReq(), {
      params: Promise.resolve(baseParams),
    })
    expect(res.status).toBe(409)
    const body = await readJson<any>(res)
    expect(body.code).toBe('vm_locked')
    expect(body.lock).toBe('snapshot')
  })

  // roadmap#265: Terraform takes a 404 as "already deleted". A guest DRS moved
  // is not gone: its config is missing on the URL node only.
  describe('a guest whose config is missing on the URL node', () => {
    const missing = () => new Error(`PVE 500 /nodes/${NODE}/qemu/${VMID}/status/current: Configuration file 'nodes/${NODE}/qemu-server/${VMID}.conf' does not exist`)

    it('404 when the cluster hosts no such guest', async () => {
      pveFetchMock.mockImplementation(async (_conn: unknown, path: string) => {
        if (path === '/cluster/resources?type=vm') return []
        throw missing()
      })
      const res = await DELETE(makeReq(), { params: Promise.resolve(baseParams) })
      expect(res.status).toBe(404)
      expect(await readJson<any>(res)).toEqual({ error: 'Guest not found' })
    })

    it('409 naming the node when the guest moved, and nothing deleted', async () => {
      pveFetchMock.mockImplementation(async (_conn: unknown, path: string) => {
        if (path === '/cluster/resources?type=vm') return [{ vmid: Number(VMID), type: 'qemu', node: 'pve-other' }]
        throw missing()
      })
      const res = await DELETE(makeReq(), { params: Promise.resolve(baseParams) })
      expect(res.status).toBe(409)
      expect(await readJson<any>(res)).toMatchObject({ code: 'vm_moved', node: 'pve-other' })
      expect(pveFetchMock.mock.calls.some((c: unknown[]) => (c[2] as { method?: string } | undefined)?.method === 'DELETE')).toBe(false)
    })

    it('names the new node only to a caller who may view the guest there', async () => {
      pveFetchMock.mockImplementation(async (_conn: unknown, path: string) => {
        if (path === '/cluster/resources?type=vm') return [{ vmid: Number(VMID), type: 'qemu', node: 'pve-other' }]
        throw missing()
      })
      const forbidden = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
      checkPermissionMock.mockImplementation(async (perm: string, _t: string, resource: string) =>
        perm === 'vm.view' && resource.includes('pve-other') ? forbidden : null)
      const res = await DELETE(makeReq(), { params: Promise.resolve(baseParams) })
      expect(res.status).toBe(403)
      expect(JSON.stringify(await readJson<any>(res))).not.toContain('pve-other')
    })

    it('500, never 404, when the cluster cannot be listed', async () => {
      pveFetchMock.mockImplementation(async () => { throw missing() })
      const res = await DELETE(makeReq(), { params: Promise.resolve(baseParams) })
      expect(res.status).toBe(500)
    })
  })

  it('400 when VM is running', async () => {
    pveFetchMock.mockResolvedValueOnce({ status: 'running' })
    const res = await DELETE(makeReq(), {
      params: Promise.resolve(baseParams),
    })
    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body.code).toBe('vm_running')
  })

  it('200 happy path: qemu VM deleted, IPAM released, audit called', async () => {
    pveFetchMock
      .mockResolvedValueOnce({ status: 'stopped' }) // status check
      .mockResolvedValueOnce('UPID:delete:task') // DELETE
    const res = await DELETE(makeReq(), {
      params: Promise.resolve(baseParams),
    })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.success).toBe(true)

    // Status check call
    expect(pveFetchMock).toHaveBeenNthCalledWith(
      1,
      { id: CONN_ID },
      `/nodes/${NODE}/qemu/${VMID}/status/current`,
      { method: 'GET' }
    )
    // Delete call (no purge/destroy flags)
    expect(pveFetchMock).toHaveBeenNthCalledWith(
      2,
      { id: CONN_ID },
      `/nodes/${NODE}/qemu/${VMID}`,
      { method: 'DELETE' }
    )

    expect(releaseAllocationsForVmMock).toHaveBeenCalledWith(CONN_ID, 101)
    // The destroy task is journaled: a vDC tenant session follows it by this
    // line once the guest, and its vDC scope, are gone (task status route).
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', resourceId: VMID, details: expect.objectContaining({ upid: 'UPID:delete:task' }) })
    )
  })

  // roadmap#192: a reload right after the delete used to bring the guest back
  // from the cached inventory for up to two minutes.
  describe('cached inventory', () => {
    async function seededCache() {
      const cache = await import('@/lib/cache/inventoryCache')
      cache.invalidateInventoryCache()
      cache.clearGuestTombstone(CONN_ID, 'qemu', VMID)
      cache.setCachedInventory({
        clusters: [{ id: CONN_ID, nodes: [{ node: NODE, status: 'online', guests: [
          { vmid: 100, type: 'qemu', node: NODE, status: 'stopped' },
          { vmid: 101, type: 'qemu', node: NODE, status: 'stopped' },
        ] }] }],
        pbsServers: [], externalHypervisors: [], storageResources: [],
        stats: { totalClusters: 1, totalNodes: 1, totalGuests: 2, onlineNodes: 1, runningGuests: 0, totalPbsServers: 0, totalDatastores: 0, totalBackups: 0 },
      } as any)
      return () => {
        const hit = cache.getInventoryFromCache()
        return hit.status === 'miss' ? null : hit.data.clusters[0].nodes[0].guests.map((g: any) => g.vmid)
      }
    }

    it('drops the deleted guest from the cached inventory', async () => {
      const cachedVmids = await seededCache()
      pveFetchMock.mockResolvedValueOnce({ status: 'stopped' }).mockResolvedValueOnce('UPID:delete:task')
      const res = await DELETE(makeReq(), { params: Promise.resolve(baseParams) })
      expect(res.status).toBe(200)
      expect(cachedVmids()).toEqual([100])
    })

    it('keeps the guest when Proxmox refused the delete', async () => {
      const cachedVmids = await seededCache()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      pveFetchMock.mockResolvedValueOnce({ status: 'stopped' }).mockRejectedValueOnce(new Error('PVE 500'))
      const res = await DELETE(makeReq(), { params: Promise.resolve(baseParams) })
      expect(res.status).toBe(500)
      expect(cachedVmids()).toEqual([100, 101])
    })
  })

  it('200 happy path: qemu VM deleted with purge and destroy-unreferenced-disks flags', async () => {
    pveFetchMock
      .mockResolvedValueOnce({ status: 'stopped' })
      .mockResolvedValueOnce('UPID:delete:task')
    const url = `http://test.local/_?purge=1&destroy-unreferenced-disks=1`
    const res = await DELETE(makeReq(url), {
      params: Promise.resolve(baseParams),
    })
    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenNthCalledWith(
      2,
      { id: CONN_ID },
      `/nodes/${NODE}/qemu/${VMID}?purge=1&destroy-unreferenced-disks=1`,
      { method: 'DELETE' }
    )
  })

  // ui#1460, measured on the lab: the default delete of the UI wiped the disk
  // of another cluster's guest with the same VMID on a shared storage.
  it.each(['qemu', 'lxc'])('200 %s: destroy-unreferenced-disks dropped and the kept volumes named', async (type) => {
    pveFetchMock
      .mockResolvedValueOnce({ status: 'stopped' })
      .mockResolvedValueOnce('UPID:delete:task')
    decideMock.mockResolvedValueOnce({ destroyUnreferenced: false, keptVolumes: ['Shared:vm-101-disk-1'] })
    const res = await DELETE(makeReq(`http://test.local/_?purge=1&destroy-unreferenced-disks=1`), {
      params: Promise.resolve({ ...baseParams, type }),
    })
    expect(res.status).toBe(200)
    expect(decideMock).toHaveBeenCalledWith({ conn: { id: CONN_ID }, connectionId: CONN_ID, node: NODE, type, vmid: VMID })
    expect(pveFetchMock).toHaveBeenNthCalledWith(2, { id: CONN_ID }, `/nodes/${NODE}/${type}/${VMID}?purge=1`, { method: 'DELETE' })
    const body = await readJson<any>(res)
    expect(body.keptVolumes).toEqual(['Shared:vm-101-disk-1'])
    expect(body.warning).toBeUndefined()
  })

  it('names no volume to a vDC session: its storages may lie outside its vDC', async () => {
    pveFetchMock
      .mockResolvedValueOnce({ status: 'stopped' })
      .mockResolvedValueOnce('UPID:delete:task')
    decideMock.mockResolvedValueOnce({ destroyUnreferenced: false, keptVolumes: ['Shared:vm-101-disk-1'] })
    vdcSessionMock.mockResolvedValueOnce(true)
    const res = await DELETE(makeReq(`http://test.local/_?purge=1&destroy-unreferenced-disks=1`), { params: Promise.resolve(baseParams) })
    const body = await readJson<any>(res)
    expect(body.keptVolumes).toEqual([])
    expect(JSON.stringify(body)).not.toContain('Shared')
    expect(JSON.stringify(auditMock.mock.calls)).not.toContain('Shared')
  })

  // Both notes reach the caller: the IPAM one used to be swallowed by the UI.
  it('keeps the IPAM warning apart from the kept volumes', async () => {
    pveFetchMock
      .mockResolvedValueOnce({ status: 'stopped' })
      .mockResolvedValueOnce('UPID:delete:task')
    decideMock.mockResolvedValueOnce({ destroyUnreferenced: false, keptVolumes: ['Shared:vm-101-disk-1'] })
    releaseAllocationsForVmMock.mockRejectedValueOnce(new Error('db down'))
    const res = await DELETE(makeReq(`http://test.local/_?purge=1&destroy-unreferenced-disks=1`), { params: Promise.resolve(baseParams) })
    const body = await readJson<any>(res)
    expect(body.warning).toBe('IPAM release failed: db down')
    expect(body.keptVolumes).toEqual(['Shared:vm-101-disk-1'])
  })

  it('does not check the shared storages when unreferenced disks are not asked for', async () => {
    pveFetchMock
      .mockResolvedValueOnce({ status: 'stopped' })
      .mockResolvedValueOnce('UPID:delete:task')
    const res = await DELETE(makeReq(`http://test.local/_?purge=1`), { params: Promise.resolve(baseParams) })
    expect(res.status).toBe(200)
    expect(decideMock).not.toHaveBeenCalled()
    expect((await readJson<any>(res)).keptVolumes).toBeUndefined()
  })

  it('200 happy path: lxc container deleted, IPAM NOT released', async () => {
    pveFetchMock
      .mockResolvedValueOnce({ status: 'stopped' })
      .mockResolvedValueOnce('UPID:delete:lxc')
    const res = await DELETE(makeReq(), {
      params: Promise.resolve({ ...baseParams, type: 'lxc' }),
    })
    expect(res.status).toBe(200)
    expect(releaseAllocationsForVmMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'containers', resourceType: 'lxc' })
    )
  })

  it('500 when pveFetch throws on DELETE', async () => {
    pveFetchMock
      .mockResolvedValueOnce({ status: 'stopped' })
      .mockRejectedValueOnce(new Error('PVE 500'))
    const res = await DELETE(makeReq(), {
      params: Promise.resolve(baseParams),
    })
    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toBe('PVE 500')
  })

  it('IPAM release failure is surfaced as a warning, VM still deleted', async () => {
    pveFetchMock
      .mockResolvedValueOnce({ status: 'stopped' })
      .mockResolvedValueOnce('UPID:delete:task')
    releaseAllocationsForVmMock.mockRejectedValue(new Error('IPAM down'))
    const res = await DELETE(makeReq(), {
      params: Promise.resolve(baseParams),
    })
    // The VM is already gone in PVE, so we must not fail the request: it still
    // succeeds (200) but the IPAM failure is reported via body.warning + audit.
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.success).toBe(true)
    expect(body.warning).toMatch(/IPAM release failed/i)
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete',
        details: expect.objectContaining({
          ipamReleaseError: expect.stringMatching(/IPAM release failed/i),
        }),
      })
    )
  })
})
