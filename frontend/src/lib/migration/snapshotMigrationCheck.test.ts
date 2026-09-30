/**
 * #1027: what checkSnapshotMigration() reads from PVE to feed the rule, and
 * how the migrate route's guard picks live or offline from the real state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const pveFetchMock = vi.fn<(conn: any, path: string) => Promise<any>>()
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))

const { checkSnapshotMigration, describeSnapshotBlockers, snapshotMigrationGuard } = await import('./snapshotMigrationCheck')

const conn = { id: 'conn-1' } as any
const VM = { node: 'pve1', type: 'qemu' as const, vmid: '100' }
const VOLID = 'ZFS-Pool:vm-100-disk-0'

/** PVE answers keyed by path; anything else fails the test loudly. */
function pve(routes: Record<string, any>) {
  pveFetchMock.mockImplementation(async (_conn, path) => {
    if (!(path in routes)) throw new Error(`unexpected PVE call ${path}`)
    return routes[path]
  })
}

const held = (extra: Record<string, any> = {}) => ({
  '/nodes/pve1/qemu/100/snapshot': [{ name: 'before-upgrade' }, { name: 'current' }],
  '/nodes/pve1/qemu/100/snapshot/before-upgrade/config': { scsi0: `${VOLID},size=32G` },
  '/storage': [{ storage: 'ZFS-Pool', type: 'zfspool' }, { storage: 'local-lvm', type: 'lvmthin' }, {}],
  '/cluster/replication': [],
  ...extra,
})

beforeEach(() => {
  pveFetchMock.mockReset()
})

describe('checkSnapshotMigration', () => {
  it('stops after the snapshot list when the guest has no snapshot', async () => {
    pve({ '/nodes/pve1/qemu/100/snapshot': [{ name: 'current' }] })

    expect(await checkSnapshotMigration(conn, VM, { target: 'pve2' })).toEqual({ live: [], offline: [] })
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats a non-list snapshot answer as no snapshot', async () => {
    pve({ '/nodes/pve1/qemu/100/snapshot': null })

    expect(await checkSnapshotMigration(conn, VM, { target: 'pve2' })).toEqual({ live: [], offline: [] })
  })

  it('blocks only the live migration of a ZFS disk held by a snapshot', async () => {
    pve(held())

    const check = await checkSnapshotMigration(conn, VM, { target: 'pve2' })

    expect(check.live).toEqual([{ volid: VOLID, storage: 'ZFS-Pool', snapshots: ['before-upgrade'], reason: 'live' }])
    expect(check.offline).toEqual([])
  })

  it('lifts the live block when a job replicates the guest to the target', async () => {
    pve(held({ '/cluster/replication': [{ guest: 100, target: 'pve2' }, { guest: 101, target: 'pve3' }] }))

    expect((await checkSnapshotMigration(conn, VM, { target: 'pve2' })).live).toEqual([])
  })

  it('keeps the live block when the job replicates to another node', async () => {
    pve(held({ '/cluster/replication': [{ guest: 100, target: 'pve3' }] }))

    expect((await checkSnapshotMigration(conn, VM, { target: 'pve2' })).live).toHaveLength(1)
  })

  it('keeps the live block for a disk excluded from replication', async () => {
    pve(held({
      '/cluster/replication': [{ guest: 100, target: 'pve2' }],
      '/nodes/pve1/qemu/100/snapshot/before-upgrade/config': { scsi0: `${VOLID},replicate=0,size=32G`, name: 'before-upgrade', snaptime: 1 },
    }))

    expect((await checkSnapshotMigration(conn, VM, { target: 'pve2' })).live).toHaveLength(1)
  })

  it('does not count a replicated job on a non-replicating storage', async () => {
    pve(held({
      '/cluster/replication': [{ guest: 100, target: 'pve2' }],
      '/nodes/pve1/qemu/100/snapshot/before-upgrade/config': { scsi0: 'local-lvm:vm-100-disk-0,size=8G', scsi1: 'gone:vm-100-disk-1' },
    }))

    const check = await checkSnapshotMigration(conn, VM, { target: 'pve2' })
    expect(check.live.map(b => b.reason)).toEqual(['storage'])
  })

  it('reads an LXC guest without asking for replication jobs, and survives odd PVE answers', async () => {
    pve({
      '/nodes/pve1/lxc/200/snapshot': [{ name: 's1' }],
      '/nodes/pve1/lxc/200/snapshot/s1/config': null,
      '/storage': null,
    })

    expect(await checkSnapshotMigration(conn, { node: 'pve1', type: 'lxc', vmid: '200' }, { target: 'pve2' }))
      .toEqual({ live: [], offline: [] })
    expect(pveFetchMock.mock.calls.map(c => c[1])).not.toContain('/cluster/replication')
  })

  it('flags a ZFS volume sent to another storage type, live and offline', async () => {
    pve(held())

    const check = await checkSnapshotMigration(conn, VM, { target: 'pve2', targetStorage: 'local-lvm' })
    expect(check.live.map(b => b.reason)).toEqual(['target'])
    expect(check.offline.map(b => b.reason)).toEqual(['target'])
  })
})

describe('snapshotMigrationGuard', () => {
  it('uses the live verdict for a running VM', async () => {
    pve(held({ '/nodes/pve1/qemu/100/status/current': { status: 'running' } }))

    expect(await snapshotMigrationGuard(conn, VM, { target: 'pve2' })).toHaveLength(1)
  })

  it('uses the offline verdict for a stopped VM', async () => {
    pve(held({ '/nodes/pve1/qemu/100/status/current': { status: 'stopped' } }))

    expect(await snapshotMigrationGuard(conn, VM, { target: 'pve2' })).toEqual([])
  })

  it('skips the status read when nothing blocks either way', async () => {
    pve({ '/nodes/pve1/qemu/100/snapshot': [] })

    expect(await snapshotMigrationGuard(conn, VM, { target: 'pve2' })).toEqual([])
  })

  it('never reads a status for LXC, which has no live mode', async () => {
    pve({
      '/nodes/pve1/lxc/200/snapshot': [{ name: 's1' }],
      '/nodes/pve1/lxc/200/snapshot/s1/config': { rootfs: 'local-lvm:vm-200-disk-0,size=8G' },
      '/storage': [{ storage: 'local-lvm', type: 'lvmthin' }],
    })

    const blockers = await snapshotMigrationGuard(conn, { node: 'pve1', type: 'lxc', vmid: '200' }, { target: 'pve2' })
    expect(blockers.map(b => b.reason)).toEqual(['storage'])
  })
})

describe('describeSnapshotBlockers', () => {
  it('writes one sentence per volume, naming the snapshots and the remedy', () => {
    const text = describeSnapshotBlockers([
      { volid: VOLID, storage: 'ZFS-Pool', snapshots: ['a', 'b'], reason: 'live' },
      { volid: 'local-lvm:vm-100-disk-1', storage: 'local-lvm', snapshots: ['a'], reason: 'storage' },
      { volid: 'ZFS-Pool:vm-100-disk-2', storage: 'ZFS-Pool', snapshots: ['a'], reason: 'target' },
    ])
    expect(text).toContain(`Snapshot(s) a, b on local volume ${VOLID} blocks a live migration`)
    expect(text).toContain('shared storage')
    expect(text).toContain('same type')
  })
})
