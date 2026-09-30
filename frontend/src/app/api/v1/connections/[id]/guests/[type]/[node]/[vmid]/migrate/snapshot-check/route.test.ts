/**
 * #1027: GET .../migrate/snapshot-check tells the migrate dialog which local
 * volumes snapshots hold, live and offline, before PVE aborts the task.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const checkMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  buildVmResourceId: (id: string, node: string, type: string, vmid: string) => `${id}/${node}/${type}/${vmid}`,
  PERMISSIONS: { VM_MIGRATE: 'vm.migrate' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async () => ({ id: 'conn-1' }) }))
vi.mock('@/lib/migration/snapshotMigrationCheck', () => ({ checkSnapshotMigration: checkMock }))

async function loadGet() {
  const mod = await import('./route')
  return mod.GET as Parameters<typeof callRoute>[0]
}

const params = { id: 'conn-1', type: 'qemu', node: 'pve1', vmid: '100' }
const RESULT = { live: [{ volid: 'ZFS-Pool:vm-100-disk-0', storage: 'ZFS-Pool', snapshots: ['s1'], reason: 'live' }], offline: [] }

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  checkMock.mockReset().mockResolvedValue(RESULT)
})

describe('GET migrate/snapshot-check', () => {
  it('returns the live and offline blockers for the chosen target', async () => {
    const res = await callRoute(await loadGet(), { params, searchParams: { target: 'pve2' } })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: RESULT })
    expect(checkMock).toHaveBeenCalledWith({ id: 'conn-1' }, { node: 'pve1', type: 'qemu', vmid: '100' }, { target: 'pve2', targetStorage: undefined })
    expect(checkPermissionMock).toHaveBeenCalledWith('vm.migrate', 'vm', 'conn-1/pve1/qemu/100')
  })

  it('passes the target storage and the LXC type through', async () => {
    await callRoute(await loadGet(), { params: { ...params, type: 'lxc' }, searchParams: { target: 'pve2', targetstorage: 'ZFS-Pool' } })

    expect(checkMock).toHaveBeenCalledWith(expect.anything(), { node: 'pve1', type: 'lxc', vmid: '100' }, { target: 'pve2', targetStorage: 'ZFS-Pool' })
  })

  it('rejects a missing or malformed target before reading PVE', async () => {
    for (const searchParams of [{}, { target: 'pve2;rm' }]) {
      const res = await callRoute(await loadGet(), { params, searchParams })
      expect(res.status).toBe(400)
    }
    expect(checkMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed vmid', async () => {
    const res = await callRoute(await loadGet(), { params: { ...params, vmid: 'abc' }, searchParams: { target: 'pve2' } })

    expect(res.status).toBe(400)
  })

  it('answers the RBAC denial as is', async () => {
    checkPermissionMock.mockResolvedValue(new Response('{}', { status: 403 }))

    const res = await callRoute(await loadGet(), { params, searchParams: { target: 'pve2' } })

    expect(res.status).toBe(403)
    expect(checkMock).not.toHaveBeenCalled()
  })

  it('reports a PVE failure as a 500 with its message', async () => {
    checkMock.mockRejectedValue(new Error('pve down'))

    const res = await callRoute(await loadGet(), { params, searchParams: { target: 'pve2' } })

    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('pve down')
  })

  it('reports a non-Error failure as a string', async () => {
    checkMock.mockRejectedValue('boom')

    const res = await callRoute(await loadGet(), { params, searchParams: { target: 'pve2' } })

    expect((await res.json()).error).toBe('boom')
  })
})
