import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn(), PERMISSIONS: { CONNECTION_VIEW: 'connection.view' } }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: vi.fn() }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn() }))

import { checkPermission } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { classifyReplicationDisk, classifyReplicationVM, discoverReplicationStorages, replicationDiscovery } from './replicationDiscovery'

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(checkPermission).mockResolvedValue(null)
})

describe('replication discovery permissions and failures', () => {
  const ctx = { params: Promise.resolve({ id: 'conn' }) }

  it('checks connection.view before resolving the connection or reading PVE', async () => {
    const denied = new NextResponse(null, { status: 403 })
    vi.mocked(checkPermission).mockResolvedValue(denied)
    expect(await replicationDiscovery(ctx, vi.fn())).toBe(denied)
    expect(checkPermission).toHaveBeenCalledWith('connection.view', 'connection', 'conn')
    expect(getConnectionById).not.toHaveBeenCalled()
    expect(pveFetch).not.toHaveBeenCalled()
  })

  it('returns an error when storage discovery fails', async () => {
    vi.mocked(pveFetch).mockRejectedValue(new Error('offline'))
    const result = await replicationDiscovery(ctx, vi.fn())
    expect(result.status).toBe(500)
    expect(await result.json()).toEqual({ error: 'offline' })
  })

  it('handles missing PVE collections and non-Error failures', async () => {
    vi.mocked(pveFetch).mockResolvedValue(null)
    const result = await replicationDiscovery(ctx, ({ configs, resources }) => ({ configs, resources }))
    expect(await result.json()).toEqual({ configs: [], resources: [] })
    vi.mocked(getConnectionById).mockRejectedValue('connection unavailable')
    expect(await (await replicationDiscovery(ctx, vi.fn())).json()).toEqual({ error: 'connection unavailable' })
  })
})

describe('replication disk classification', () => {
  const storages = new Set(['local-zfs'])

  it.each([
    ['local-zfs:vm-1-disk-0', 'engine'],
    ['/dev/disk/by-id/drive,replicate=0', 'optout'],
    ['none,media=cdrom', 'cdrom'],
    ['local:vm-1-disk-0', 'other'],
    ['/dev/sdb', 'unsupported'],
  ])('classifies %s as %s', (line, kind) => {
    expect(classifyReplicationDisk(line, storages)).toBe(kind)
  })

  it('counts all six device families and sums fractional sizes, including EFI and TPM', () => {
    expect(classifyReplicationVM({
      scsi0: 'local-zfs:a,size=1T', virtio0: 'local-zfs:b,size=1.5G',
      sata0: 'local-zfs:c,size=512M', ide0: 'local-zfs:d,size=1G',
      efidisk0: 'local-zfs:e,size=4M', tpmstate0: 'local-zfs:f,size=4M',
      unused0: 'other:g,size=1T', scsi1: 'other:h,replicate=0,size=1T', ide1: 'none,media=cdrom',
    }, storages)).toEqual({ diskGb: 1027, mixed: false, unsupported: false })
  })

  it('retains engine disks without known sizes and flags other storage and passthrough', () => {
    expect(classifyReplicationVM({ scsi0: 'local-zfs:a', scsi1: 'other:b', scsi2: '/dev/sda' }, storages))
      .toEqual({ diskGb: 0, mixed: true, unsupported: true })
    expect(classifyReplicationVM({ efidisk0: 'local-zfs:a,size=1024K' }, storages)?.diskGb).toBe(0)
    expect(classifyReplicationVM({ scsi0: 'local-zfs:a,size=bad' }, storages)?.diskGb).toBe(0)
    expect(classifyReplicationVM({ scsi0: 'other:b' }, storages)).toBeNull()
  })
})

it('does not advertise a configured ZFS pool without eligible node resources', () => {
  expect(discoverReplicationStorages([{ storage: 'local-zfs', type: 'zfspool', content: 'images', nodes: 'pve2' }], [
    { storage: 'local-zfs', type: 'storage', plugintype: 'zfspool', node: 'pve1' },
  ])).toEqual({ engines: [], rbd: [], zfs: [] })
})
