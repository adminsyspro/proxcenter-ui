/**
 * POST /api/v1/guests/[vmid]/snapshots/[snapname] -- rollback (Finding I1):
 * a snapshot taken before a storage policy existed hands the drive lines
 * back verbatim on rollback, potentially restoring a self-chosen QoS on a
 * now-policied storage. The post-rollback restamp after() block closes
 * this the same way clone/restore already do (via the shared
 * restampGuestDrives helper in driveGuard.ts, kept REAL here so the actual
 * restamp logic runs against the mocked PVE calls).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const h = vi.hoisted(() => ({ afterCbs: [] as Array<() => Promise<void>> }))

vi.mock('next/server', async (io) => {
  const actual = await io<typeof import('next/server')>()
  return { ...actual, after: (fn: () => Promise<void>) => { h.afterCbs.push(fn) } }
})

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const getCurrentTenantIdMock = vi.fn<() => Promise<string>>()
const getTenantInfrastructureScopeMock = vi.fn<(...args: any[]) => Promise<any>>()
const waitForTaskMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  buildVmResourceId: () => 'res',
  PERMISSIONS: { VM_SNAPSHOT: 'vm.snapshot' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: () => getCurrentTenantIdMock() }))
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: (...a: any[]) => getTenantInfrastructureScopeMock(...a),
}))
vi.mock('@/lib/proxmox/tasks', () => ({ waitForTask: (...a: any[]) => waitForTaskMock(...a) }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))

async function loadPost() {
  const mod = await import('./route')
  return mod.POST as Parameters<typeof callRoute>[0]
}

const VM_KEY = 'conn-1:qemu:pve3:101'
const baseParams = { vmid: VM_KEY, snapname: 'pre-policy' }

const gold = { policyId: 'p-gold', name: 'Gold', iopsRd: 5000, iopsWr: 4000, mbpsRd: 500, mbpsWr: null }

/** iaas union scope with the given per-connection allowed storages + tier policies. */
function iaasScope(storages: string[], policies: Record<string, typeof gold> = {}) {
  return {
    kind: 'iaas',
    vdcScope: {
      storagesByConnection: new Map([['conn-1', new Set(storages)]]),
      storagePoliciesByConnection: new Map([['conn-1', new Map(Object.entries(policies))]]),
    },
  }
}

beforeEach(() => {
  h.afterCbs.length = 0
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn-1' })
  getCurrentTenantIdMock.mockReset().mockResolvedValue('tenant-x')
  getTenantInfrastructureScopeMock.mockReset().mockResolvedValue({ kind: 'provider' })
  waitForTaskMock.mockReset().mockResolvedValue(undefined)
  pveFetchMock.mockReset().mockImplementation(async (_conn, _path: string, opts?: any) => {
    if (opts?.method === 'POST') return 'UPID:pve3:rollback:101:root@pam:'
    if (opts?.method === 'PUT') return null
    return {}
  })
})

function configPutCall() {
  return pveFetchMock.mock.calls.find(
    (c) => String(c[1]).endsWith('/qemu/101/config') && c[2]?.method === 'PUT',
  )
}

describe('POST rollback: post-rollback QoS restamp (Finding I1)', () => {
  it('iaas: a rolled-back config carrying stale QoS on a policied storage -- restamp PUT captured with the policy caps', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme'], { 'ceph-nvme': gold }))
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:pve3:rollback:101:root@pam:'
      if (opts?.method === 'PUT') return null
      if (String(path).endsWith('/qemu/101/config')) {
        return { scsi0: 'ceph-nvme:vm-101-disk-0,size=32G,iops_rd=1' }
      }
      return {}
    })

    const POST = await loadPost()
    const res = await callRoute(POST, { method: 'POST', params: baseParams })
    expect(res.status).toBe(200)

    expect(h.afterCbs.length).toBeGreaterThan(0)
    for (const cb of h.afterCbs) await cb()

    expect(waitForTaskMock).toHaveBeenCalledWith({ id: 'conn-1' }, 'pve3', 'UPID:pve3:rollback:101:root@pam:')

    const putCall = configPutCall()
    expect(putCall).toBeTruthy()
    const patch = new URLSearchParams(String(putCall?.[2]?.body))
    expect(patch.get('scsi0')).toBe('ceph-nvme:vm-101-disk-0,size=32G,iops_rd=5000,iops_wr=4000,mbps_rd=500')
  })

  it('no policies on the connection: no restamp after() work scheduled, no PUT', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme']))
    const POST = await loadPost()
    const res = await callRoute(POST, { method: 'POST', params: baseParams })
    expect(res.status).toBe(200)
    expect(h.afterCbs.length).toBe(0)
    expect(configPutCall()).toBeUndefined()
  })

  it('lxc rollback: never scheduled, even with policies on the connection', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme'], { 'ceph-nvme': gold }))
    const POST = await loadPost()
    const res = await callRoute(POST, {
      method: 'POST',
      params: { vmid: 'conn-1:lxc:pve3:101', snapname: 'pre-policy' },
    })
    expect(res.status).toBe(200)
    expect(h.afterCbs.length).toBe(0)
  })

  it('provider: unchanged, no restamp attempted', async () => {
    getCurrentTenantIdMock.mockResolvedValue('default')
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    pveFetchMock.mockImplementation(async (_conn, path: string, opts?: any) => {
      if (opts?.method === 'POST') return 'UPID:pve3:rollback:101:root@pam:'
      if (opts?.method === 'PUT') return null
      if (String(path).endsWith('/qemu/101/config')) {
        return { scsi0: 'local-lvm:vm-101-disk-0,size=32G,iops_rd=1' }
      }
      return {}
    })

    const POST = await loadPost()
    const res = await callRoute(POST, { method: 'POST', params: baseParams })
    expect(res.status).toBe(200)
    expect(h.afterCbs.length).toBe(0)
  })
})
