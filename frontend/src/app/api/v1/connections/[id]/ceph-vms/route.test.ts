import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<Response | null | undefined>>(),
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view' },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

import { checkPermission } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'

const { GET } = await import('./route')

const checkPermissionMock = vi.mocked(checkPermission)
const getConnectionByIdMock = vi.mocked(getConnectionById)
const pveFetchMock = vi.mocked(pveFetch)

describe('GET /api/v1/connections/:id/ceph-vms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkPermissionMock.mockResolvedValue(null)
    getConnectionByIdMock.mockResolvedValue({ id: 'conn-1' })
    pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
      if (path === '/storage') {
        return [{ type: 'rbd', storage: 'cephpool' }]
      }
      if (path === '/cluster/resources') {
        return [
          { type: 'qemu', vmid: 100, node: 'pve1', status: 'running' },
          { type: 'qemu', vmid: 101, node: 'pve1', status: 'stopped' },
          { type: 'lxc', vmid: 102, node: 'pve1', status: 'running' },
          { type: 'qemu', vmid: 103, node: 'pve1', status: 'stopped', template: 1 },
        ]
      }
      if (path === '/nodes/pve1/qemu/100/config') {
        return { scsi0: 'cephpool:vm-100-disk-0,size=32G' }
      }
      if (path === '/nodes/pve1/qemu/101/config') {
        return { scsi0: 'cephpool:vm-101-disk-0,size=32G' }
      }
      throw new Error(`Unexpected PVE path: ${path}`)
    })
  })

  it('returns running and stopped QEMU guests with Ceph disks, but excludes LXC guests and templates', async () => {
    const response = await callRoute(GET as any, {
      method: 'GET',
      params: { id: 'conn-1' },
    })
    const body = await readJson<{ data: Array<{ vmid: number; cephDiskGb: number }> }>(response)

    expect(response.status).toBe(200)
    expect(body?.data).toEqual([
      { vmid: 100, cephDiskGb: 32 },
      { vmid: 101, cephDiskGb: 32 },
    ])
    expect(body?.data.some(vm => vm.vmid === 102)).toBe(false)
    expect(pveFetchMock).toHaveBeenCalledWith({ id: 'conn-1' }, '/nodes/pve1/qemu/100/config')
    expect(pveFetchMock).toHaveBeenCalledWith({ id: 'conn-1' }, '/nodes/pve1/qemu/101/config')
    expect(pveFetchMock).not.toHaveBeenCalledWith({ id: 'conn-1' }, '/nodes/pve1/qemu/102/config')
    expect(pveFetchMock).not.toHaveBeenCalledWith({ id: 'conn-1' }, '/nodes/pve1/qemu/103/config')
  })
})
