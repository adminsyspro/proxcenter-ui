import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn(), PERMISSIONS: { CONNECTION_VIEW: 'connection.view' } }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: vi.fn() }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn() }))

import { pveFetch } from '@/lib/proxmox/client'
import { GET } from './route'

const get = (query = '') => GET(new Request(`http://localhost/${query}`), { params: Promise.resolve({ id: 'conn' }) })

beforeEach(() => vi.resetAllMocks())

it.each(['', '?engine=ceph', '?engine='])('rejects a missing or unknown engine (%s)', async query => {
  expect((await get(query)).status).toBe(400)
  expect(pveFetch).not.toHaveBeenCalled()
})

it.each(['rbd', 'zfs'])('returns %s guests in either power state, including EFI/TPM-only guests and mixed/unsupported flags', async engine => {
  vi.mocked(pveFetch).mockImplementation(async (_conn, path) => {
    if (path === '/storage') return [{ storage: 'pool', type: engine === 'zfs' ? 'zfspool' : 'rbd' }]
    if (path === '/cluster/resources') return [
      { type: 'qemu', node: 'n1', vmid: 100, status: 'running' },
      { type: 'qemu', node: 'n1', vmid: 101, status: 'stopped' },
      { type: 'qemu', node: 'n1', vmid: 102, template: 1 },
      { type: 'lxc', node: 'n1', vmid: 103 },
      { type: 'qemu', node: 'n1', vmid: 104 },
    ]
    if (path.includes('/100/')) return { efidisk0: 'pool:a,size=128M', tpmstate0: 'pool:b,size=128M' }
    if (path.includes('/101/')) return { scsi0: 'pool:a,size=2G', sata0: 'other:b', virtio0: '/dev/sda' }
    return { scsi0: 'other:a' }
  })
  const result = await get(`?engine=${engine}`)
  expect(await result.json()).toEqual([
    { vmid: 100, node: 'n1', diskGb: 0.3, mixed: false, unsupported: false },
    { vmid: 101, node: 'n1', diskGb: 2, mixed: true, unsupported: true },
  ])
  expect(vi.mocked(pveFetch).mock.calls.map(call => call[1])).not.toContain('/nodes/n1/qemu/102/config')
  expect(vi.mocked(pveFetch).mock.calls.map(call => call[1])).not.toContain('/nodes/n1/qemu/103/config')
})

it('returns an empty list without reading configs when the engine has no storage', async () => {
  vi.mocked(pveFetch).mockResolvedValue([])
  expect(await (await get('?engine=zfs')).json()).toEqual([])
  expect(pveFetch).toHaveBeenCalledTimes(2)
})

it('skips a guest whose configuration cannot be read instead of failing the whole list', async () => {
  vi.mocked(pveFetch).mockImplementation(async (_conn, path) => {
    if (path === '/storage') return [{ storage: 'pool', type: 'zfspool' }]
    if (path === '/cluster/resources') return [{ type: 'qemu', node: 'n1', vmid: 100 }, { type: 'qemu', node: 'n1', vmid: 101 }]
    if (String(path).endsWith('/qemu/101/config')) return { scsi0: 'pool:vm-101-disk-0,size=4G' }
    throw new Error('config unavailable')
  })
  const response = await get('?engine=zfs')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual([{ vmid: 101, node: 'n1', diskGb: 4, mixed: false, unsupported: false }])
})
