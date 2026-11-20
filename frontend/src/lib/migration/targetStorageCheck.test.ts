/**
 * #1402: what checkTargetStorage() reads from PVE to tell whether a target
 * storage will be honoured, dropped (HA, replication) or needs a disk move.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const pveFetchMock = vi.fn<(conn: any, path: string) => Promise<any>>()
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))

const { checkTargetStorage } = await import('./targetStorageCheck')

const conn = { id: 'conn-1' } as any
const VM = { node: 'pve1', type: 'qemu' as const, vmid: '100' }

/** PVE answers keyed by path; anything else fails the test loudly. */
function pve(routes: Record<string, any>) {
  pveFetchMock.mockImplementation(async (_conn, path) => {
    if (!(path in routes)) throw new Error(`unexpected PVE call ${path}`)
    return routes[path]
  })
}

const guest = (extra: Record<string, any> = {}) => ({
  '/nodes/pve1/qemu/100/config': { scsi0: 'ZFS-Pool:vm-100-disk-0,size=32G' },
  '/nodes/pve1/qemu/100/status/current': { status: 'running' },
  '/storage': [{ storage: 'ZFS-Pool', type: 'zfspool' }, { storage: 'ceph', type: 'rbd' }, {}],
  '/cluster/ha/resources': [],
  '/cluster/replication': [],
  ...extra,
})

beforeEach(() => {
  pveFetchMock.mockReset()
})

describe('checkTargetStorage', () => {
  it('reads nothing from PVE when no target storage is asked for', async () => {
    expect(await checkTargetStorage(conn, VM, { target: 'pve2' })).toEqual({ kind: 'direct' })
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('leaves a plain guest to PVE', async () => {
    pve(guest())

    expect(await checkTargetStorage(conn, VM, { target: 'pve2', targetStorage: 'ceph' })).toEqual({ kind: 'direct' })
    expect(pveFetchMock).toHaveBeenCalledTimes(5)
  })

  it('asks for a disk move first when the guest is HA-managed', async () => {
    pve(guest({ '/cluster/ha/resources': [{ sid: 'vm:200' }, { sid: 'vm:100', state: 'started' }] }))

    expect(await checkTargetStorage(conn, VM, { target: 'pve2', targetStorage: 'ceph' })).toEqual({
      kind: 'move-first',
      disks: [{ id: 'scsi0', volid: 'ZFS-Pool:vm-100-disk-0' }],
    })
  })

  it('does not take a VM for the HA container of the same id', async () => {
    pve(guest({ '/cluster/ha/resources': [{ sid: 'ct:100' }] }))

    expect(await checkTargetStorage(conn, VM, { target: 'pve2', targetStorage: 'ceph' })).toEqual({ kind: 'direct' })
  })

  it('refuses a running HA container, read on the lxc endpoints', async () => {
    pve({
      '/nodes/pve1/lxc/100/config': { rootfs: 'ZFS-Pool:subvol-100-disk-0,size=8G' },
      '/nodes/pve1/lxc/100/status/current': { status: 'running' },
      '/storage': [{ storage: 'ZFS-Pool', type: 'zfspool' }, { storage: 'ceph', type: 'rbd' }],
      '/cluster/ha/resources': [{ sid: 'ct:100' }],
      '/cluster/replication': [],
    })

    expect(await checkTargetStorage(conn, { ...VM, type: 'lxc' }, { target: 'pve2', targetStorage: 'ceph' }))
      .toMatchObject({ kind: 'blocked', reason: 'ha-running-container' })
  })

  it('refuses the disks a job replicates to the target, and only that guest\'s jobs', async () => {
    pve(guest({ '/cluster/replication': [{ guest: 200, target: 'pve2' }, { guest: 100, target: 'pve2' }] }))

    expect(await checkTargetStorage(conn, VM, { target: 'pve2', targetStorage: 'ceph' })).toEqual({
      kind: 'blocked',
      reason: 'replicated',
      volids: ['ZFS-Pool:vm-100-disk-0'],
    })
  })

  it('reads non-list answers as empty', async () => {
    pve(guest({ '/cluster/ha/resources': null, '/cluster/replication': null, '/storage': null, '/nodes/pve1/qemu/100/status/current': null }))

    expect(await checkTargetStorage(conn, VM, { target: 'pve2', targetStorage: 'ceph' })).toEqual({ kind: 'direct' })
  })
})
