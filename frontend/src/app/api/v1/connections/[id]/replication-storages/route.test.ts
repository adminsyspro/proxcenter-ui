import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn(), PERMISSIONS: { CONNECTION_VIEW: 'connection.view' } }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: vi.fn() }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn() }))

import { pveFetch } from '@/lib/proxmox/client'
import { GET } from './route'

beforeEach(() => vi.resetAllMocks())

it('returns the exact discovery contract with one ZFS row per allowed node', async () => {
  vi.mocked(pveFetch).mockImplementation(async (_conn, path) => path === '/storage' ? [
    { storage: 'ceph', type: 'rbd', pool: 'rbd-pool', content: 'images' },
    { storage: 'local-zfs', type: 'zfspool', pool: 'rpool/data', content: 'images,rootdir', nodes: 'pve1,pve2' },
    { storage: 'disabled', type: 'zfspool', content: 'images', disable: 1 },
    { storage: 'rootdir', type: 'zfspool', content: 'rootdir' },
    { storage: 'absent', type: 'zfspool', content: 'images' },
    { storage: 'nfs', type: 'nfs', content: 'images' },
  ] : ['pve1', 'pve2', 'pve3'].flatMap(node => [
    { type: 'storage', storage: 'local-zfs', plugintype: 'zfspool', node, status: node === 'pve1' ? 'available' : 'unavailable', maxdisk: 2048, disk: 1024 },
    { type: 'storage', storage: 'disabled', plugintype: 'zfspool', node },
    { type: 'storage', storage: 'rootdir', plugintype: 'zfspool', node },
  ]))
  const result = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'conn' }) })
  expect(result.status).toBe(200)
  expect(await result.json()).toEqual({
    engines: ['rbd', 'zfs'], rbd: [{ storage: 'ceph', pool: 'rbd-pool' }], zfs: [
      { storage: 'local-zfs', node: 'pve1', pool: 'rpool/data', availBytes: 1024, totalBytes: 2048, availFormatted: '1 KiB', active: true },
      { storage: 'local-zfs', node: 'pve2', pool: 'rpool/data', availBytes: 1024, totalBytes: 2048, availFormatted: '1 KiB', active: false },
    ],
  })
})

it('handles unrestricted nodes, absent counters and a pool default', async () => {
  vi.mocked(pveFetch).mockImplementation(async (_conn, path) => path === '/storage'
    ? [{ storage: 'zfs', type: 'zfspool', content: 'images' }, { storage: 'rbd', type: 'rbd', content: 'images' }]
    : [{ type: 'storage', storage: 'zfs', plugintype: 'zfspool', node: 'pve1' }])
  const result = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'conn' }) })
  expect(await result.json()).toMatchObject({ engines: ['rbd', 'zfs'], rbd: [{ storage: 'rbd', pool: 'rbd' }], zfs: [{ pool: 'zfs', availBytes: 0, totalBytes: 0, active: false }] })
})
