import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn<(...args: any[]) => Promise<any>>() }))

import { pveFetch } from '@/lib/proxmox/client'
import { findPoolGuestDisks } from './poolGuests'

/*
   ui#1450: before a pool is deleted, the guest disks still on the PVE storages
   that use it. A storage whose content cannot be read makes the answer
   unknown: the deletion is refused rather than guessed.
*/

const pveFetchMock = pveFetch as any
const conn = { id: 'c1' }

const STORAGES = [
  { storage: 'vm-pool', type: 'rbd', pool: 'vm-pool' },
  { storage: 'vm-pool-ct', type: 'rbd', pool: 'vm-pool', krbd: 1 },
  // A PVE storage without `pool` uses the pool named like the storage.
  { storage: 'other', type: 'rbd' },
  { storage: 'local', type: 'dir' },
]

function route(map: Record<string, unknown>) {
  pveFetchMock.mockImplementation(async (_c: any, path: string) => {
    if (path in map) {
      const v = map[path]
      if (v instanceof Error) throw v
      return v
    }
    throw new Error(`unexpected ${path}`)
  })
}

beforeEach(() => vi.clearAllMocks())

describe('findPoolGuestDisks', () => {
  it('lists the guest disks of every storage on the pool', async () => {
    route({
      '/storage': STORAGES,
      '/nodes/pve1/storage/vm-pool/content': [
        { volid: 'vm-pool:vm-100-disk-0', content: 'images', vmid: 100 },
        { volid: 'vm-pool:base-9000-disk-0', content: 'images', vmid: 9000 },
      ],
      '/nodes/pve1/storage/vm-pool-ct/content': [{ volid: 'vm-pool-ct:vm-101-disk-0', content: 'rootdir', vmid: 101 }],
    })
    expect(await findPoolGuestDisks(conn, 'pve1', 'vm-pool')).toEqual({
      storages: ['vm-pool', 'vm-pool-ct'],
      disks: ['vm-pool:vm-100-disk-0', 'vm-pool:base-9000-disk-0', 'vm-pool-ct:vm-101-disk-0'],
      unreadable: [],
    })
  })

  it('matches a storage named like the pool when it carries no pool field', async () => {
    route({ '/storage': STORAGES, '/nodes/pve1/storage/other/content': [] })
    expect(await findPoolGuestDisks(conn, 'pve1', 'other')).toEqual({ storages: ['other'], disks: [], unreadable: [] })
  })

  it('reports a storage whose content cannot be read', async () => {
    route({ '/storage': STORAGES, '/nodes/pve1/storage/vm-pool/content': new Error('storage is not online'), '/nodes/pve1/storage/vm-pool-ct/content': [] })
    expect(await findPoolGuestDisks(conn, 'pve1', 'vm-pool')).toEqual({ storages: ['vm-pool', 'vm-pool-ct'], disks: [], unreadable: ['vm-pool'] })
  })

  it('finds nothing for a pool no storage uses', async () => {
    route({ '/storage': STORAGES })
    expect(await findPoolGuestDisks(conn, 'pve1', 'scratch')).toEqual({ storages: [], disks: [], unreadable: [] })
  })
})
