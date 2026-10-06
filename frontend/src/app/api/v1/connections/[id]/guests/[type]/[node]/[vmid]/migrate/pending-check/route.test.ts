/**
 * #926: GET .../migrate/pending-check lists the configuration changes a guest
 * has not applied yet, so the migrate dialogs can warn before PVE fails.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  buildVmResourceId: (id: string, node: string, type: string, vmid: string) => `${id}/${node}/${type}/${vmid}`,
  PERMISSIONS: { VM_MIGRATE: 'vm.migrate' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async () => ({ id: 'conn-1' }) }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))

async function loadGet() {
  const mod = await import('./route')
  return mod.GET as Parameters<typeof callRoute>[0]
}

const params = { id: 'conn-1', type: 'qemu', node: 'pve1', vmid: '100' }

// What PVE answers for a running VM whose memory was raised and whose second
// NIC was removed without a restart.
const PVE_PENDING = [
  { key: 'cores', value: 2 },
  { key: 'digest', value: 'b3c1f0' },
  { key: 'memory', value: '2048', pending: '4096' },
  { key: 'net1', value: 'virtio=BC:24:11:00:00:01,bridge=vmbr1', delete: 1 },
  { key: 'scsi1', pending: 'local-lvm:vm-100-disk-1,size=8G' },
]

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  pveFetchMock.mockReset().mockResolvedValue(PVE_PENDING)
})

describe('GET migrate/pending-check', () => {
  it('returns only the changes waiting for a restart', async () => {
    const res = await callRoute(await loadGet(), { params })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      data: {
        changes: [
          { key: 'memory', value: '2048', pending: '4096' },
          { key: 'net1', value: 'virtio=BC:24:11:00:00:01,bridge=vmbr1', delete: true },
          { key: 'scsi1', pending: 'local-lvm:vm-100-disk-1,size=8G' },
        ],
      },
    })
    expect(pveFetchMock).toHaveBeenCalledWith({ id: 'conn-1' }, '/nodes/pve1/qemu/100/pending')
    expect(checkPermissionMock).toHaveBeenCalledWith('vm.migrate', 'vm', 'conn-1/pve1/qemu/100')
  })

  it('reads the container endpoint for an lxc guest', async () => {
    pveFetchMock.mockResolvedValue([{ key: 'memory', value: '512' }])

    const res = await callRoute(await loadGet(), { params: { ...params, type: 'lxc' } })

    expect(await res.json()).toEqual({ data: { changes: [] } })
    expect(pveFetchMock).toHaveBeenCalledWith(expect.anything(), '/nodes/pve1/lxc/100/pending')
  })

  it('rejects a malformed node or vmid before reading PVE', async () => {
    for (const bad of [{ ...params, node: 'pve1;rm' }, { ...params, vmid: '10x' }]) {
      const res = await callRoute(await loadGet(), { params: bad })
      expect(res.status).toBe(400)
    }
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('answers the RBAC denial as is', async () => {
    checkPermissionMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }))

    const res = await callRoute(await loadGet(), { params })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('reports a PVE failure as a 500', async () => {
    pveFetchMock.mockRejectedValue(new Error('PVE unreachable'))

    const res = await callRoute(await loadGet(), { params })

    expect(res.status).toBe(500)
  })
})
