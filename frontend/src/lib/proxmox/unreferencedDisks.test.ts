import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: { connection: { findMany: vi.fn<(...args: any[]) => Promise<any[]>>() } },
}))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string, tenantId?: string) => Promise<any>>(),
}))
vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

import { prisma } from '@/lib/db/prisma'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'

import { decideUnreferencedDiskPurge, keptVolumesNote, referencedVolids } from './unreferencedDisks'

const findManyMock = prisma.connection.findMany as any
const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any

const SOURCE = { id: 'prod', baseUrl: 'https://prod', apiToken: 't' }
const OTHER = { id: 'dr', baseUrl: 'https://dr', apiToken: 't' }

type Cluster = {
  storages?: any[]
  config?: Record<string, unknown> | Error
  content?: Record<string, any[] | Error>
  resources?: any[] | Error
  snapshots?: Record<string, Record<string, unknown>>
}

function wire(clusters: Record<string, Cluster>) {
  pveFetchMock.mockImplementation(async (conn: { id: string }, path: string) => {
    const c = clusters[conn.id]
    if (path.startsWith('/nodes/pve1/storage?')) return c.storages ?? []
    if (path === '/nodes/pve1/qemu/101/config' || path === '/nodes/pve1/lxc/101/config') {
      if (c.config instanceof Error) throw c.config
      return c.config ?? {}
    }
    if (/^\/nodes\/pve1\/(qemu|lxc)\/101\/snapshot$/.test(path)) {
      return [...Object.keys(c.snapshots ?? {}).map(name => ({ name })), { name: 'current' }]
    }
    const snap = /^\/nodes\/pve1\/(?:qemu|lxc)\/101\/snapshot\/([^/]+)\/config$/.exec(path)
    if (snap) return c.snapshots?.[decodeURIComponent(snap[1])] ?? {}
    const content = /^\/nodes\/pve1\/storage\/([^/]+)\/content\?vmid=101$/.exec(path)
    if (content) {
      const listed = c.content?.[decodeURIComponent(content[1])] ?? []
      if (listed instanceof Error) throw listed
      return listed
    }
    if (path === '/cluster/resources?type=vm') {
      if (c.resources instanceof Error) throw c.resources
      return c.resources ?? []
    }
    throw new Error(`unexpected ${conn.id} ${path}`)
  })
}

const sharedRbd = { storage: 'Shared', type: 'rbd', shared: 1, content: 'images,rootdir', enabled: 1, active: 1 }
const localLvm = { storage: 'local-lvm', type: 'lvmthin', shared: 0, content: 'images,rootdir', enabled: 1, active: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  findManyMock.mockResolvedValue([{ id: 'dr', tenantId: 'default' }])
  getConnectionByIdMock.mockImplementation(async (id: string) => (id === 'dr' ? OTHER : SOURCE))
})

const decide = (type: 'qemu' | 'lxc' = 'qemu') =>
  decideUnreferencedDiskPurge({ conn: SOURCE, connectionId: 'prod', node: 'pve1', type, vmid: '101' })

describe('referencedVolids', () => {
  it('collects the volume of every disk, mount point and unused entry', () => {
    const refs = referencedVolids({
      scsi0: 'Shared:vm-101-disk-0,size=8G',
      ide2: 'none,media=cdrom',
      unused0: 'Shared:vm-101-disk-2',
      mp0: 'Shared:vm-101-disk-3,mp=/data',
      efidisk0: 'Shared:base-100-disk-0/vm-101-disk-4,efitype=4m',
      net0: 'virtio=BC:24:11:00:00:01,bridge=vmbr0',
      name: 'web',
      memory: 2048,
    })
    expect([...refs].sort()).toEqual([
      'Shared:base-100-disk-0/vm-101-disk-4',
      'Shared:vm-101-disk-0',
      'Shared:vm-101-disk-2',
      'Shared:vm-101-disk-3',
    ])
  })
})

describe('decideUnreferencedDiskPurge', () => {
  it('lets PVE destroy unreferenced disks when the node has no shared storage', async () => {
    wire({ prod: { storages: [localLvm] } })
    expect(await decide()).toEqual({ destroyUnreferenced: true, keptVolumes: [] })
    expect(findManyMock).not.toHaveBeenCalled()
  })

  it('lets PVE destroy them when no shared volume of this VMID is unreferenced', async () => {
    wire({
      prod: {
        storages: [sharedRbd, localLvm],
        config: { scsi0: 'Shared:vm-101-disk-0,size=8G' },
        content: { Shared: [{ volid: 'Shared:vm-101-disk-0', vmid: 101 }] },
      },
    })
    expect(await decide()).toEqual({ destroyUnreferenced: true, keptVolumes: [] })
    expect(findManyMock).not.toHaveBeenCalled()
  })

  it('lets PVE destroy a shared orphan no other managed cluster can own', async () => {
    wire({
      prod: {
        storages: [sharedRbd],
        config: { scsi0: 'Shared:vm-101-disk-0,size=8G' },
        content: { Shared: [{ volid: 'Shared:vm-101-disk-0', vmid: 101 }, { volid: 'Shared:vm-101-disk-1', vmid: 101 }] },
      },
      dr: { resources: [{ vmid: 202, node: 'pve1-dr' }] },
    })
    expect(await decide()).toEqual({ destroyUnreferenced: true, keptVolumes: [] })
  })

  // Measured on the lab (ui#1460): a guest of another cluster with the same
  // VMID on the same storage lost its disk to this very flag.
  it('keeps a shared orphan when another managed cluster runs a guest with this VMID', async () => {
    wire({
      prod: {
        storages: [sharedRbd, localLvm],
        config: { scsi0: 'Shared:vm-101-disk-0,size=8G' },
        content: { Shared: [{ volid: 'Shared:vm-101-disk-0', vmid: 101 }, { volid: 'Shared:vm-101-disk-1', vmid: '101' }] },
      },
      dr: { resources: [{ vmid: 101, node: 'pve1-dr' }] },
    })
    expect(await decide()).toEqual({ destroyUnreferenced: false, keptVolumes: ['Shared:vm-101-disk-1'] })
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { type: 'pve', id: { not: 'prod' } } }))
    expect(getConnectionByIdMock).toHaveBeenCalledWith('dr', 'default')
  })

  it('reads the container config for an LXC guest', async () => {
    wire({
      prod: {
        storages: [sharedRbd],
        config: { rootfs: 'Shared:vm-101-disk-0,size=8G' },
        content: { Shared: [{ volid: 'Shared:vm-101-disk-0', vmid: 101 }, { volid: 'Shared:vm-101-disk-1', vmid: 101 }] },
      },
      dr: { resources: [{ vmid: 101 }] },
    })
    expect(await decide('lxc')).toEqual({ destroyUnreferenced: false, keptVolumes: ['Shared:vm-101-disk-1'] })
  })

  it('ignores a listed volume of another VMID and a storage without guest disks', async () => {
    wire({
      prod: {
        storages: [sharedRbd, { storage: 'NFS-ISO', type: 'nfs', shared: 1, content: 'iso,vztmpl' }],
        config: {},
        content: { Shared: [{ volid: 'Shared:vm-1010-disk-0', vmid: 1010 }] },
      },
    })
    expect(await decide()).toEqual({ destroyUnreferenced: true, keptVolumes: [] })
    expect(pveFetchMock).not.toHaveBeenCalledWith(SOURCE, expect.stringContaining('NFS-ISO'))
  })

  it('keeps the orphan when another cluster cannot be read', async () => {
    wire({
      prod: {
        storages: [sharedRbd],
        config: {},
        content: { Shared: [{ volid: 'Shared:vm-101-disk-1', vmid: 101 }] },
      },
      dr: { resources: new Error('PVE unreachable') },
    })
    expect(await decide()).toEqual({ destroyUnreferenced: false, keptVolumes: ['Shared:vm-101-disk-1'] })
  })

  it('keeps unreferenced disks when a shared storage cannot be listed and another cluster has this VMID', async () => {
    wire({
      prod: { storages: [sharedRbd], config: {}, content: { Shared: new Error('rbd timeout') } },
      dr: { resources: [{ vmid: 101 }] },
    })
    expect(await decide()).toEqual({ destroyUnreferenced: false, keptVolumes: [] })
  })

  it('keeps unreferenced disks when the config cannot be read and another cluster has this VMID', async () => {
    wire({
      prod: { storages: [sharedRbd], config: new Error('PVE 500') },
      dr: { resources: [{ vmid: 101 }] },
    })
    expect(await decide()).toEqual({ destroyUnreferenced: false, keptVolumes: [] })
  })

  // A dead NFS export on a single cluster must not stop every purge.
  it('lets PVE destroy them when a listing fails but no other cluster has this VMID', async () => {
    wire({
      prod: { storages: [sharedRbd], config: {}, content: { Shared: new Error('rbd timeout') } },
      dr: { resources: [{ vmid: 202 }] },
    })
    expect(await decide()).toEqual({ destroyUnreferenced: true, keptVolumes: [] })
  })

  it('lets PVE destroy them when no other PVE connection exists', async () => {
    findManyMock.mockResolvedValue([])
    wire({ prod: { storages: [sharedRbd], config: {}, content: { Shared: new Error('rbd timeout') } } })
    expect(await decide()).toEqual({ destroyUnreferenced: true, keptVolumes: [] })
  })

  it('ignores the backups of this VMID on a shared storage', async () => {
    wire({
      prod: {
        storages: [{ ...sharedRbd, type: 'nfs', storage: 'NFS', content: 'images,backup' }],
        config: {},
        content: { NFS: [{ volid: 'NFS:backup/vzdump-qemu-101-2026_11_28-01_00_00.vma.zst', vmid: 101, content: 'backup' }] },
      },
      dr: { resources: [{ vmid: 101 }] },
    })
    expect(await decide()).toEqual({ destroyUnreferenced: true, keptVolumes: [] })
  })

  // PVE deletes what a snapshot references (RAM state, detached disks) with
  // the guest, flag or not: those are not orphans.
  it('counts the volumes its snapshots reference as its own', async () => {
    wire({
      prod: {
        storages: [sharedRbd],
        config: { scsi0: 'Shared:vm-101-disk-0,size=8G' },
        content: { Shared: [
          { volid: 'Shared:vm-101-disk-0', vmid: 101, content: 'images' },
          { volid: 'Shared:vm-101-state-before', vmid: 101, content: 'images' },
          { volid: 'Shared:vm-101-disk-1', vmid: 101, content: 'images' },
        ] },
        snapshots: { before: { vmstate: 'Shared:vm-101-state-before', scsi0: 'Shared:vm-101-disk-0,size=8G' } },
      },
      dr: { resources: [{ vmid: 101 }] },
    })
    expect(await decide()).toEqual({ destroyUnreferenced: false, keptVolumes: ['Shared:vm-101-disk-1'] })
  })

  it('keeps unreferenced disks when the storages of the node cannot be read', async () => {
    pveFetchMock.mockRejectedValue(new Error('PVE unreachable'))
    expect(await decide()).toEqual({ destroyUnreferenced: false, keptVolumes: [] })
  })
})

describe('keptVolumesNote', () => {
  it('is empty when nothing was kept', () => {
    expect(keptVolumesNote({ destroyUnreferenced: true, keptVolumes: [] })).toBe('')
  })

  it('names the kept volumes', () => {
    expect(keptVolumesNote({ destroyUnreferenced: false, keptVolumes: ['Shared:vm-101-disk-1'] }))
      .toBe('Kept Shared:vm-101-disk-1: another cluster runs a guest with this VMID and may use it.')
  })

  it('says unreferenced disks were kept when they could not be checked', () => {
    expect(keptVolumesNote({ destroyUnreferenced: false, keptVolumes: [] }))
      .toBe('Unreferenced disks were kept: the shared storages could not be checked and another cluster runs a guest with this VMID.')
  })
})
