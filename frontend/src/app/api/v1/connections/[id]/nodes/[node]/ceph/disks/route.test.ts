import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

/*
   ui#1450: what the Create OSD dialog needs about one node: its free disks
   (PVE API) and whether the SSH account may run pveceph osd create there.
*/

vi.mock('@/lib/ceph/tenantGuard', () => ({ denyIaasTenantCeph: vi.fn(async () => null) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: vi.fn(), isConnectionNotFoundError: () => false }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn<(...args: any[]) => Promise<any>>() }))
vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn<(...args: any[]) => Promise<any>>(), PERMISSIONS: { STORAGE_ADMIN: 'storage.admin' } }))
vi.mock('@/lib/ssh/node-endpoint', () => ({ resolveNodeSshEndpoint: vi.fn(async () => '10.42.0.101') }))
vi.mock('@/lib/ceph/detachedPveceph', () => ({ sudoAllows: vi.fn() }))

import { GET } from './route'
import { checkPermission } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { sudoAllows } from '@/lib/ceph/detachedPveceph'
import { pveFetch } from '@/lib/proxmox/client'

const DISKS = [
  { devpath: '/dev/sda', size: 32, used: 'BIOS boot', osdid: -1 },
  { devpath: '/dev/sdg', size: 10737418240, model: 'QEMU_HARDDISK', serial: 's6', type: 'hdd', wearout: 'N/A', osdid: -1 },
]

beforeEach(() => {
  vi.clearAllMocks()
  ;(checkPermission as any).mockResolvedValue(null)
  ;(getConnectionById as any).mockResolvedValue({ id: 'c1' })
  ;(pveFetch as any).mockImplementation(async (_c: any, path: string) => {
    if (path === '/nodes') return [{ node: 'pve1' }]
    if (path === '/nodes/pve1/disks/list') return DISKS
    if (path === '/nodes/pve1/disks/list?type=journal_disks') return [{ devpath: '/dev/nvme0n1', size: 5, used: 'LVM', osdid: -1, model: 'NVME' }]
    throw new Error(`unexpected ${path}`)
  })
  ;(sudoAllows as any).mockResolvedValue('missing-rule')
})

describe('GET /api/v1/connections/[id]/nodes/[node]/ceph/disks', () => {
  it('lists the free disks and the SSH verdict for pveceph osd create', async () => {
    const res = await callRoute(GET, { params: { id: 'c1', node: 'pve1' } })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({
      data: {
        disks: [{ devpath: '/dev/sdg', sizeBytes: 10737418240, model: 'QEMU_HARDDISK', serial: 's6', type: 'hdd', wearout: 'N/A' }],
        journalDisks: [{ devpath: '/dev/nvme0n1', sizeBytes: 5, model: 'NVME', serial: '', type: '', wearout: '' }],
        ssh: 'missing-rule',
      },
    })
    expect((sudoAllows as any).mock.calls[0][2]).toEqual(['/usr/bin/pveceph', 'osd', 'create', '/dev/sdb'])
  })

  it('refuses a node of another cluster', async () => {
    const res = await callRoute(GET, { params: { id: 'c1', node: 'pve9' } })
    expect(res.status).toBe(404)
  })

  it('stops at the permission check', async () => {
    ;(checkPermission as any).mockResolvedValue(new Response(null, { status: 403 }))
    const res = await callRoute(GET, { params: { id: 'c1', node: 'pve1' } })
    expect(res.status).toBe(403)
    expect(pveFetch).not.toHaveBeenCalled()
  })
})
