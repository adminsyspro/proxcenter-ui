import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  pveFetch: vi.fn(),
  moveFindUnique: vi.fn(),
  moveUpdate: vi.fn(),
  moveUpdateMany: vi.fn(),
  moveFindMany: vi.fn(),
  ipamFindMany: vi.fn(),
  ipamUpdate: vi.fn(),
  ipamDelete: vi.fn(),
  loadVdcById: vi.fn(),
  loadPveConnection: vi.fn(),
  watch: vi.fn(),
  audit: vi.fn(),
  refresh: vi.fn(),
  forget: vi.fn(),
}))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: h.pveFetch }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    vdcMove: { findUnique: h.moveFindUnique, update: h.moveUpdate, updateMany: h.moveUpdateMany, findMany: h.moveFindMany },
    vdcIpamAllocation: { findMany: h.ipamFindMany, update: h.ipamUpdate, delete: h.ipamDelete },
  },
}))
vi.mock('@/lib/audit', () => ({ audit: h.audit }))
vi.mock('@/lib/cache/guestSetRefresh', () => ({ refreshCachedGuests: h.refresh }))
vi.mock('@/lib/cache/inventoryCache', () => ({ forgetCachedGuest: h.forget }))
vi.mock('@/lib/migration/cross-cluster-watcher', () => ({ watchMigrationAndCleanup: h.watch }))
vi.mock('@/lib/migration/orphan-sweep', () => ({ resolveInstanceId: () => 'replica-b' }))
vi.mock('@/lib/scheduler/lease', () => ({ tryAcquireLease: vi.fn(async () => true), releaseLease: vi.fn(async () => {}) }))
vi.mock('./context', async (orig) => ({ ...(await orig<any>()), loadVdcById: h.loadVdcById, loadPveConnection: h.loadPveConnection, connectionOwnerTenant: async () => 'default' }))

import { finalizeMove, followMove, reconcileMoves } from './runner'

const SOURCE_VDC = {
  id: 'vdc-src', name: 'Paris', poolName: 'vdc-acme-paris', networks: [],
  policies: [{ policyId: 'p1', name: 'Gold', storageId: 'ceph-gold', quotaMb: null, caps: { iopsRd: 500, iopsWr: null, mbpsRd: null, mbpsWr: null } }],
}
const TARGET_VDC = {
  id: 'vdc-dst', name: 'Lyon', poolName: 'vdc-acme-lyon',
  policies: [{ policyId: 'p2', name: 'Gold', storageId: 'nvme-gold', quotaMb: null, caps: { iopsRd: 1000, iopsWr: null, mbpsRd: 200, mbpsWr: null } }],
  networks: [{ bridge: 'tnet01', label: 'lan', kind: 'vnet', vnetId: 'vn-b', tenantNetworkId: 'net-lan' }],
}

const MOVE = {
  id: 'm1', tenantId: 'acme', guestName: 'web-01', vmid: 105, targetVmid: 105,
  sourceConnectionId: 'conn-a', sourceNode: 'pve1', sourceVdcId: 'vdc-src',
  targetConnectionId: 'conn-b', targetNode: 'pve1-dr', targetVdcId: 'vdc-dst',
  storageMap: { 'ceph-gold': 'nvme-gold', 'ceph-silver': 'rbd' }, bridgeMap: { tnet01: 'tnet01', vlan10: 'vmbr1' },
  online: true, deleteSource: true, origin: 'tenant', status: 'copying', upid: 'UPID:pve1:x', requestedBy: 'ops@acme.test',
}

const TARGET_CONFIG = {
  scsi0: 'nvme-gold:vm-105-disk-0,iops_rd=500,size=20G',
  scsi1: 'rbd:vm-105-disk-1,iops_wr=50,size=10G',
  ide2: 'none,media=cdrom',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.moveFindUnique.mockResolvedValue({ ...MOVE })
  h.moveUpdate.mockResolvedValue({})
  h.moveUpdateMany.mockResolvedValue({ count: 1 })
  h.loadVdcById.mockImplementation(async (id: string) => (id === 'vdc-src' ? SOURCE_VDC : id === 'vdc-dst' ? TARGET_VDC : null))
  h.loadPveConnection.mockImplementation(async (id: string) => ({ id }))
  h.audit.mockResolvedValue(undefined)
  h.refresh.mockResolvedValue(undefined)
  h.ipamFindMany.mockResolvedValue([])
  h.ipamUpdate.mockResolvedValue({})
  h.ipamDelete.mockResolvedValue({})
  h.pveFetch.mockImplementation(async (_conn: any, path: string, init?: any) => {
    if (path.endsWith('/config') && !init) return TARGET_CONFIG
    return null
  })
})

describe('finalizeMove', () => {
  it('puts the guest in the target pool and swaps the tier caps', async () => {
    await finalizeMove('m1')

    const pool = h.pveFetch.mock.calls.find((c) => c[1] === '/pools/vdc-acme-lyon')!
    expect(pool[0]).toEqual({ id: 'conn-b' })
    expect(Object.fromEntries(new URLSearchParams(pool[2].body))).toEqual({ vms: '105', 'allow-move': '1' })

    const put = h.pveFetch.mock.calls.find((c) => c[1] === '/nodes/pve1-dr/qemu/105/config' && c[2]?.method === 'PUT')!
    expect(Object.fromEntries(new URLSearchParams(put[2].body))).toEqual({
      // policied on both sides: target tier caps replace the source ones
      scsi0: 'nvme-gold:vm-105-disk-0,size=20G,iops_rd=1000,mbps_rd=200',
      // ceph-silver had no policy and rbd has none: hand-set caps stay, so scsi1 is untouched
    })
    expect(h.moveUpdate).toHaveBeenLastCalledWith({ where: { id: 'm1' }, data: expect.objectContaining({ status: 'done', holder: null }) })
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'acme', userEmail: 'ops@acme.test', details: expect.objectContaining({ fromVdc: 'Paris', toVdc: 'Lyon' }) }))
    expect(h.forget).toHaveBeenCalledWith('conn-a', 'qemu', 105)
    expect(h.refresh).toHaveBeenCalledWith('conn-b', { id: 'conn-b' }, { type: 'qemu', vmid: 105 })
  })

  it('keeps the address on a stretched network and releases it elsewhere', async () => {
    h.ipamFindMany.mockResolvedValue([
      { id: 'a1', ip: '10.0.0.5', vnet: { pveName: 'tnet01', tenantNetworkMember: { tenantNetworkId: 'net-lan' } } },
      { id: 'a2', ip: '192.168.9.7', vnet: { pveName: 'vlan10', tenantNetworkMember: null } },
    ])
    await finalizeMove('m1')

    expect(h.ipamUpdate).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { vdcId: 'vdc-dst', vnetId: 'vn-b', connectionId: 'conn-b', vmid: 105 } })
    expect(h.ipamDelete).toHaveBeenCalledWith({ where: { id: 'a2' } })
    expect(h.moveUpdate).toHaveBeenLastCalledWith({ where: { id: 'm1' }, data: expect.objectContaining({ status: 'done', warnings: [{ code: 'ADDRESS_RELEASED', context: { ip: '192.168.9.7' } }] }) })
  })

  it('fails the move when the guest cannot join the pool, the tenant would not see it', async () => {
    h.pveFetch.mockImplementation(async (_c: any, path: string) => {
      if (path.startsWith('/pools/')) throw new Error('permission denied')
      return TARGET_CONFIG
    })
    await finalizeMove('m1')
    expect(h.moveUpdate).toHaveBeenLastCalledWith({ where: { id: 'm1' }, data: expect.objectContaining({ status: 'failed' }) })
    expect(h.audit).not.toHaveBeenCalled()
  })

  it('records a warning when the caps cannot be written, and still links the guest', async () => {
    h.pveFetch.mockImplementation(async (_c: any, path: string, init?: any) => {
      if (path.endsWith('/config') && init?.method === 'PUT') throw new Error('locked')
      return path.endsWith('/config') ? TARGET_CONFIG : null
    })
    await finalizeMove('m1', true)
    expect(h.moveUpdate).toHaveBeenLastCalledWith({ where: { id: 'm1' }, data: expect.objectContaining({
      status: 'done', warnings: [{ code: 'SOURCE_LEFT' }, { code: 'CAPS_NOT_APPLIED' }],
    }) })
  })

  it('fails when the target vDC was deleted meanwhile', async () => {
    h.loadVdcById.mockResolvedValue(null)
    await finalizeMove('m1')
    expect(h.moveUpdate).toHaveBeenLastCalledWith({ where: { id: 'm1' }, data: expect.objectContaining({ status: 'failed' }) })
  })

  it('does nothing on a finished move', async () => {
    h.moveFindUnique.mockResolvedValue({ ...MOVE, status: 'done' })
    await finalizeMove('m1')
    expect(h.pveFetch).not.toHaveBeenCalled()
  })
})

describe('pool entries left by Proxmox', () => {
  it('treats "already a pool member" as linked when the pool lists the guest', async () => {
    h.pveFetch.mockImplementation(async (conn: any, path: string, init?: any) => {
      if (path === '/pools/vdc-acme-lyon' && init?.method === 'PUT') throw new Error('update pools failed: VM 105 is already a pool member')
      if (path === '/pools/vdc-acme-lyon') return { members: [{ vmid: 105 }] }
      if (path === '/pools/vdc-acme-paris') return { members: [] }
      return path.endsWith('/config') ? TARGET_CONFIG : null
    })
    await finalizeMove('m1')
    expect(h.moveUpdate).toHaveBeenLastCalledWith({ where: { id: 'm1' }, data: expect.objectContaining({ status: 'done' }) })
  })

  it('still fails when the pool does not list the guest', async () => {
    h.pveFetch.mockImplementation(async (_c: any, path: string, init?: any) => {
      if (path === '/pools/vdc-acme-lyon' && init?.method === 'PUT') throw new Error('permission denied')
      if (path === '/pools/vdc-acme-lyon') return { members: [] }
      return path.endsWith('/config') ? TARGET_CONFIG : null
    })
    await finalizeMove('m1')
    expect(h.moveUpdate).toHaveBeenLastCalledWith({ where: { id: 'm1' }, data: expect.objectContaining({ status: 'failed' }) })
  })

  it('removes the VMID the source pool keeps once the source is gone, even unlisted', async () => {
    await finalizeMove('m1')
    const unlink = h.pveFetch.mock.calls.find((c) => c[1] === '/pools/vdc-acme-paris' && c[2]?.method === 'PUT')!
    expect(unlink[0]).toEqual({ id: 'conn-a' })
    expect(Object.fromEntries(new URLSearchParams(unlink[2].body))).toEqual({ vms: '105', delete: '1' })
  })

  it('takes "is not a pool member" as nothing to remove', async () => {
    h.pveFetch.mockImplementation(async (_c: any, path: string, init?: any) => {
      if (path === '/pools/vdc-acme-paris') throw new Error('update pools failed: VM 105 is not a pool member')
      return path.endsWith('/config') && !init ? TARGET_CONFIG : null
    })
    await finalizeMove('m1')
    expect(h.moveUpdate).toHaveBeenLastCalledWith({ where: { id: 'm1' }, data: expect.objectContaining({ status: 'done', warnings: undefined }) })
  })

  it('keeps the source pool entry when the source guest was left behind, and warns when the cleanup fails', async () => {
    h.pveFetch.mockImplementation(async (_c: any, path: string, init?: any) => {
      if (path === '/pools/vdc-acme-paris') throw new Error('denied')
      return path.endsWith('/config') && !init ? TARGET_CONFIG : null
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await finalizeMove('m1', true)
    expect(h.pveFetch.mock.calls.some((c) => c[1] === '/pools/vdc-acme-paris' && c[2]?.method === 'PUT')).toBe(false)
    await finalizeMove('m1', false)
    expect(h.moveUpdate).toHaveBeenLastCalledWith({ where: { id: 'm1' }, data: expect.objectContaining({ warnings: [{ code: 'SOURCE_POOL_ENTRY_LEFT' }] }) })
  })
})

describe('followMove', () => {
  it('watches the copy with the move poll interval, then finalizes', async () => {
    h.watch.mockImplementation(async (opts: any) => {
      await opts.onPoll()
      return { outcome: 'completed', sourceLeft: false }
    })
    await followMove('m1')
    expect(h.watch).toHaveBeenCalledWith(expect.objectContaining({ upid: 'UPID:pve1:x', deleteSource: true, pollIntervalMs: 5000, targetVmid: '105', tenantId: 'default' }))
    expect(h.moveUpdateMany).toHaveBeenCalledWith({ where: { id: 'm1', holder: 'replica-b' }, data: { heartbeatAt: expect.any(Date) } })
    expect(h.moveUpdate).toHaveBeenLastCalledWith({ where: { id: 'm1' }, data: expect.objectContaining({ status: 'done' }) })
  })

  it.each([
    [{ outcome: 'failed', exitstatus: 'migration aborted' }, 'The copy failed'],
    [{ outcome: 'timeout' }, 'did not finish in time'],
    [{ outcome: 'invalid' }, 'Invalid move'],
  ])('fails the move on %o', async (outcome, text) => {
    h.watch.mockResolvedValue(outcome)
    await followMove('m1')
    expect(h.moveUpdate).toHaveBeenLastCalledWith({ where: { id: 'm1' }, data: expect.objectContaining({ status: 'failed', error: expect.stringContaining(text) }) })
  })

  it('finalizes a move a previous follower left in finalizing', async () => {
    h.moveFindUnique.mockResolvedValue({ ...MOVE, status: 'finalizing' })
    await followMove('m1')
    expect(h.watch).not.toHaveBeenCalled()
    expect(h.moveUpdate).toHaveBeenLastCalledWith({ where: { id: 'm1' }, data: expect.objectContaining({ status: 'done' }) })
  })

  it('leaves the row for the reconciler when following throws', async () => {
    h.watch.mockRejectedValue(new Error('pve down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await followMove('m1')
    expect(h.moveUpdate).not.toHaveBeenCalled()
  })
})

describe('reconcileMoves', () => {
  it('closes a move that never reached Proxmox and claims the silent ones', async () => {
    const now = new Date('2026-11-10T20:00:00Z')
    const stale = new Date('2026-11-10T19:50:00Z')
    h.moveFindMany.mockResolvedValue([
      { id: 'q1', status: 'queued', tenantId: 'acme', heartbeatAt: stale },
      { id: 'c1', status: 'copying', tenantId: 'acme', heartbeatAt: stale },
      { id: 'c2', status: 'copying', tenantId: 'acme', heartbeatAt: stale },
    ])
    h.moveUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    h.moveFindUnique.mockResolvedValue(null) // the background follow finds nothing to do

    const taken = await reconcileMoves(now)

    expect(taken).toBe(1)
    expect(h.moveUpdate).toHaveBeenCalledWith({ where: { id: 'q1' }, data: expect.objectContaining({ status: 'failed' }) })
    expect(h.moveUpdateMany).toHaveBeenCalledWith({ where: { id: 'c1', heartbeatAt: stale }, data: { holder: 'replica-b', heartbeatAt: now } })
    expect(h.moveFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { in: ['queued', 'copying', 'finalizing'] }, OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: new Date('2026-11-10T19:58:00Z') } }] },
    }))
  })
})

describe('reconciler and helpers', () => {
  it('starts once, reconciles under the lease, and stops', async () => {
    vi.useFakeTimers()
    const { startVdcMoveReconciler, stopVdcMoveReconciler, heartbeatMove, failMove } = await import('./runner')
    h.moveFindMany.mockResolvedValue([])
    startVdcMoveReconciler()
    startVdcMoveReconciler()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(h.moveFindMany).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.moveFindMany).toHaveBeenCalledTimes(2)
    stopVdcMoveReconciler()
    vi.useRealTimers()

    await heartbeatMove('m9')
    expect(h.moveUpdateMany).toHaveBeenCalledWith({ where: { id: 'm9', holder: 'replica-b' }, data: { heartbeatAt: expect.any(Date) } })
    await failMove('m9', 'boom')
    expect(h.moveUpdate).toHaveBeenLastCalledWith({ where: { id: 'm9' }, data: expect.objectContaining({ status: 'failed', error: 'boom' }) })
  })

  it('logs and survives a failing reconcile pass', async () => {
    vi.useFakeTimers()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { startVdcMoveReconciler, stopVdcMoveReconciler } = await import('./runner')
    h.moveFindMany.mockRejectedValue(new Error('db down'))
    startVdcMoveReconciler()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(err).toHaveBeenCalledWith('[vdc-move] reconcile failed:', expect.any(Error))
    stopVdcMoveReconciler()
    vi.useRealTimers()
  })
})
